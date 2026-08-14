package backup

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestSigV4AwsExample pins the implementation to the canonical AWS Signature
// Version 4 example (GET /test.txt) so signing never silently drifts.
func TestSigV4AwsExample(t *testing.T) {
	fixed := time.Date(2013, 5, 24, 0, 0, 0, 0, time.UTC)
	client := NewS3Client(S3Config{
		Region:    "us-east-1",
		AccessKey: "AKIAIOSFODNN7EXAMPLE",
		SecretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
	}, func() time.Time { return fixed })

	req, err := http.NewRequest(http.MethodGet, "https://examplebucket.s3.amazonaws.com/test.txt", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Range", "bytes=0-9")
	client.sign(req, emptySHA256)

	auth := req.Header.Get("Authorization")
	want := "Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41"
	if !strings.Contains(auth, want) {
		t.Fatalf("signature mismatch:\n got %s\nwant contains %s", auth, want)
	}
	if !strings.Contains(auth, "Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request") {
		t.Fatalf("credential scope wrong: %s", auth)
	}
	if req.Header.Get("x-amz-date") != "20130524T000000Z" {
		t.Fatalf("x-amz-date wrong: %s", req.Header.Get("x-amz-date"))
	}
}

func TestRFC3986Encoding(t *testing.T) {
	cases := map[string]string{
		"/a b/c":      "/a%20b/c",
		"backups/x.y": "backups/x.y",
		"ümlaut":      "%C3%BCmlaut",
		"a~b-c_d.e":   "a~b-c_d.e",
	}
	for in, want := range cases {
		if got := escapePath(in); got != want {
			t.Errorf("escapePath(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestPutObjectSignsRequest(t *testing.T) {
	client := NewS3Client(S3Config{
		Endpoint:  "http://127.0.0.1:9000",
		Region:    "us-east-1",
		Bucket:    "hims-backups",
		AccessKey: "minioadmin",
		SecretKey: "minioadmin",
		PathStyle: true,
	}, nil)
	req, err := http.NewRequest(http.MethodPut, client.objectURL("backups/backup_daily_2026-01-01.sql.gz.enc"), strings.NewReader("x"))
	if err != nil {
		t.Fatal(err)
	}
	client.sign(req, emptySHA256)
	if !strings.HasPrefix(req.Header.Get("Authorization"), "AWS4-HMAC-SHA256 Credential=minioadmin/") {
		t.Fatalf("authorization header malformed: %s", req.Header.Get("Authorization"))
	}
	if req.URL.Path != "/hims-backups/backups/backup_daily_2026-01-01.sql.gz.enc" {
		t.Fatalf("path-style URL wrong: %s", req.URL.Path)
	}
}

func TestListObjectsXMLParsing(t *testing.T) {
	body := `<?xml version="1.0"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
  <IsTruncated>false</IsTruncated>
  <Contents><Key>backups/a.sql.gz.enc</Key><Size>1024</Size></Contents>
  <Contents><Key>backups/b.sql.gz.enc</Key><Size>2048</Size></Contents>
</ListBucketResult>`
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte(body))
	}))
	defer server.Close()

	client := NewS3Client(S3Config{
		Endpoint:  server.URL,
		Region:    "us-east-1",
		Bucket:    "hims-backups",
		AccessKey: "a",
		SecretKey: "s",
		PathStyle: true,
	}, nil)
	objs, err := client.ListObjects(context.Background(), "backups/")
	if err != nil {
		t.Fatal(err)
	}
	if len(objs) != 2 || objs[0].Key != "backups/a.sql.gz.enc" || objs[0].Size != 1024 {
		t.Fatalf("unexpected listing: %+v", objs)
	}
}
