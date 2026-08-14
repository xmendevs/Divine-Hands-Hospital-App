package auth

import (
	"testing"
	"time"

	"github.com/pquerna/otp/totp"
)

func TestPasswordHashVerify(t *testing.T) {
	hash, err := HashPassword("S3cretPass!")
	if err != nil {
		t.Fatal(err)
	}
	ok, err := VerifyPassword(hash, "S3cretPass!")
	if err != nil || !ok {
		t.Fatalf("expected match, got ok=%v err=%v", ok, err)
	}
	ok, _ = VerifyPassword(hash, "wrong")
	if ok {
		t.Fatal("expected mismatch for wrong password")
	}
}

func TestSessionToken(t *testing.T) {
	raw, hash, err := GenerateToken()
	if err != nil {
		t.Fatal(err)
	}
	if raw == "" || hash == "" {
		t.Fatal("empty token")
	}
	if HashToken(raw) != hash {
		t.Fatal("hash mismatch")
	}
	_, hash2, _ := GenerateToken()
	if hash2 == hash {
		t.Fatal("tokens should be unique")
	}
}

func TestTOTP(t *testing.T) {
	secret, url, err := GenerateTOTP("Test", "alice")
	if err != nil {
		t.Fatal(err)
	}
	if secret == "" || url == "" {
		t.Fatal("empty totp secret/url")
	}
	code, err := totp.GenerateCode(secret, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if !VerifyTOTP(secret, code) {
		t.Fatal("valid code rejected")
	}
	if VerifyTOTP(secret, "000000") {
		t.Fatal("invalid code accepted")
	}
}

func TestCipherRoundtrip(t *testing.T) {
	c, err := NewCipherFromHex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f")
	if err != nil {
		t.Fatal(err)
	}
	enc, err := c.Encrypt([]byte("secret-value"))
	if err != nil {
		t.Fatal(err)
	}
	dec, err := c.Decrypt(enc)
	if err != nil {
		t.Fatal(err)
	}
	if string(dec) != "secret-value" {
		t.Fatal("roundtrip mismatch")
	}

	bad, _ := NewCipherFromHex("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e20")
	if _, err := bad.Decrypt(enc); err == nil {
		t.Fatal("expected decrypt failure with wrong key")
	}
}
