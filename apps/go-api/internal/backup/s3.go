package backup

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"
)

// S3Config configures the object-storage destination. The provider must be
// configurable rather than hard-coded: any S3-compatible endpoint (MinIO,
// AWS S3, Backblaze B2, Wasabi, ...) works.
type S3Config struct {
	Endpoint  string // e.g. https://s3.amazonaws.com or http://127.0.0.1:9000
	Region    string
	Bucket    string
	Prefix    string // optional object-key prefix
	AccessKey string
	SecretKey string
	PathStyle bool // true for MinIO; AWS accepts path-style too
	Timeout   time.Duration
}

// ObjectInfo is a listed object.
type ObjectInfo struct {
	Key  string
	Size int64
}

// S3Client is a minimal AWS Signature Version 4 S3 client (put/get/delete/
// list) built on the standard library, so no heavyweight SDK dependency is
// introduced.
type S3Client struct {
	cfg  S3Config
	http *http.Client
	now  func() time.Time
}

// NewS3Client builds a client. now may be nil (defaults to time.Now).
func NewS3Client(cfg S3Config, now func() time.Time) *S3Client {
	if cfg.Timeout == 0 {
		cfg.Timeout = 2 * time.Minute
	}
	if now == nil {
		now = time.Now
	}
	return &S3Client{cfg: cfg, http: &http.Client{Timeout: cfg.Timeout}, now: now}
}

func (c *S3Client) objectURL(key string) string {
	base := strings.TrimRight(c.cfg.Endpoint, "/")
	if c.cfg.PathStyle {
		return base + "/" + url.PathEscape(c.cfg.Bucket) + "/" + escapePath(key)
	}
	return base + "/" + escapePath(key)
}

func (c *S3Client) bucketURL() string {
	base := strings.TrimRight(c.cfg.Endpoint, "/")
	return base + "/" + url.PathEscape(c.cfg.Bucket)
}

// PutObject uploads an object with a precomputed SHA-256 payload hash.
func (c *S3Client) PutObject(ctx context.Context, key string, body io.ReadSeeker, size int64, payloadHash string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, c.objectURL(key), body)
	if err != nil {
		return err
	}
	req.ContentLength = size
	c.sign(req, payloadHash)
	return c.do(req, nil)
}

// GetObjectBytes downloads a (small) object.
func (c *S3Client) GetObjectBytes(ctx context.Context, key string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.objectURL(key), nil)
	if err != nil {
		return nil, err
	}
	c.sign(req, emptySHA256)
	var buf bytes.Buffer
	if err := c.do(req, &buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// GetObjectToFile downloads an object to a file path.
func (c *S3Client) GetObjectToFile(ctx context.Context, key, path string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.objectURL(key), nil)
	if err != nil {
		return err
	}
	c.sign(req, emptySHA256)
	out, err := os.Create(path)
	if err != nil {
		return err
	}
	defer out.Close()
	return c.do(req, out)
}

// DeleteObject removes an object.
func (c *S3Client) DeleteObject(ctx context.Context, key string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, c.objectURL(key), nil)
	if err != nil {
		return err
	}
	c.sign(req, emptySHA256)
	return c.do(req, nil)
}

// ListObjects lists objects under a prefix, following continuation tokens.
func (c *S3Client) ListObjects(ctx context.Context, prefix string) ([]ObjectInfo, error) {
	var out []ObjectInfo
	token := ""
	for {
		q := url.Values{}
		q.Set("list-type", "2")
		q.Set("prefix", prefix)
		q.Set("max-keys", "1000")
		if token != "" {
			q.Set("continuation-token", token)
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.bucketURL()+"?"+q.Encode(), nil)
		if err != nil {
			return nil, err
		}
		c.sign(req, emptySHA256)
		var buf bytes.Buffer
		if err := c.do(req, &buf); err != nil {
			return nil, err
		}

		var res struct {
			XMLName     xml.Name `xml:"ListBucketResult"`
			IsTruncated bool     `xml:"IsTruncated"`
			NextToken   string   `xml:"NextContinuationToken"`
			Contents    []struct {
				Key  string `xml:"Key"`
				Size int64  `xml:"Size"`
			} `xml:"Contents"`
		}
		if err := xml.Unmarshal(buf.Bytes(), &res); err != nil {
			return nil, fmt.Errorf("parse list response: %w", err)
		}
		for _, c := range res.Contents {
			out = append(out, ObjectInfo{Key: c.Key, Size: c.Size})
		}
		if !res.IsTruncated || res.NextToken == "" {
			return out, nil
		}
		token = res.NextToken
	}
}

func (c *S3Client) do(req *http.Request, dst io.Writer) error {
	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("s3 %s %s: %s (%s)", req.Method, req.URL.Path, resp.Status, strings.TrimSpace(string(b)))
	}
	if dst != nil {
		_, err = io.Copy(dst, resp.Body)
	}
	return err
}

const emptySHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

// sign applies AWS Signature Version 4 to the request.
func (c *S3Client) sign(req *http.Request, payloadHash string) {
	now := c.now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	req.Header.Set("x-amz-date", amzDate)
	req.Header.Set("x-amz-content-sha256", payloadHash)
	req.Header.Set("Host", req.URL.Host)

	canonical, signedHeaders := canonicalRequest(req, payloadHash)
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		dateStamp + "/" + c.cfg.Region + "/s3/aws4_request",
		hexSHA256(canonical),
	}, "\n")

	kDate := hmacSHA256([]byte("AWS4"+c.cfg.SecretKey), dateStamp)
	kRegion := hmacSHA256(kDate, c.cfg.Region)
	kService := hmacSHA256(kRegion, "s3")
	kSigning := hmacSHA256(kService, "aws4_request")
	signature := hex.EncodeToString(hmacSHA256(kSigning, stringToSign))

	req.Header.Set("Authorization", fmt.Sprintf(
		"AWS4-HMAC-SHA256 Credential=%s/%s/%s/s3/aws4_request, SignedHeaders=%s, Signature=%s",
		c.cfg.AccessKey, dateStamp, c.cfg.Region, signedHeaders, signature))
}

func canonicalRequest(req *http.Request, payloadHash string) (string, string) {
	uri := escapePath(req.URL.EscapedPath())
	if uri == "" {
		uri = "/"
	}

	names := make([]string, 0, len(req.Header))
	for name := range req.Header {
		names = append(names, strings.ToLower(name))
	}
	sort.Strings(names)

	var headers strings.Builder
	for _, name := range names {
		headers.WriteString(name + ":" + strings.TrimSpace(req.Header.Get(name)) + "\n")
	}
	signed := strings.Join(names, ";")

	canonical := strings.Join([]string{
		req.Method,
		uri,
		canonicalQuery(req.URL),
		headers.String(),
		signed,
		payloadHash,
	}, "\n")
	return canonical, signed
}

func canonicalQuery(u *url.URL) string {
	vals := u.Query()
	if len(vals) == 0 {
		return ""
	}
	keys := make([]string, 0, len(vals))
	for k := range vals {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var parts []string
	for _, k := range keys {
		vv := vals[k]
		sort.Strings(vv)
		for _, v := range vv {
			parts = append(parts, rfc3986(k)+"="+rfc3986(v))
		}
	}
	return strings.Join(parts, "&")
}

// escapePath percent-encodes a URL path for SigV4 (keeps "/" separators).
func escapePath(p string) string {
	if p == "" {
		return "/"
	}
	segments := strings.Split(p, "/")
	for i, s := range segments {
		segments[i] = rfc3986(s)
	}
	return strings.Join(segments, "/")
}

// rfc3986 percent-encodes a string, leaving unreserved characters intact.
func rfc3986(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		ch := s[i]
		if ch >= 'A' && ch <= 'Z' || ch >= 'a' && ch <= 'z' || ch >= '0' && ch <= '9' ||
			ch == '-' || ch == '_' || ch == '.' || ch == '~' {
			b.WriteByte(ch)
			continue
		}
		fmt.Fprintf(&b, "%%%02X", ch)
	}
	return b.String()
}

func hmacSHA256(key []byte, data string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(data))
	return h.Sum(nil)
}

func hexSHA256(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}
