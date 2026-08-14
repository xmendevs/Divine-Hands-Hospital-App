package backup

import (
	"bytes"
	"crypto/rand"
	"os"
	"path/filepath"
	"testing"
)

func testKey(t *testing.T) []byte {
	t.Helper()
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	return key
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	key := testKey(t)
	dir := t.TempDir()
	plain := filepath.Join(dir, "plain.bin")
	enc := filepath.Join(dir, "enc.bin")
	out := filepath.Join(dir, "out.bin")

	payload := bytes.Repeat([]byte("divine hands backup payload "), 1000)
	if err := os.WriteFile(plain, payload, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := EncryptFile(key, plain, enc); err != nil {
		t.Fatal(err)
	}
	encBytes, err := os.ReadFile(enc)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(encBytes, payload) {
		t.Fatal("encrypted file leaks plaintext")
	}
	if err := DecryptFile(key, enc, out); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(out)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, payload) {
		t.Fatal("decrypted payload differs from original")
	}
}

func TestDecryptTamperedFails(t *testing.T) {
	key := testKey(t)
	dir := t.TempDir()
	plain := filepath.Join(dir, "plain.bin")
	enc := filepath.Join(dir, "enc.bin")
	if err := os.WriteFile(plain, []byte("sensitive patient data"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := EncryptFile(key, plain, enc); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(enc)
	if err != nil {
		t.Fatal(err)
	}
	b[len(b)-1] ^= 0xFF
	if err := os.WriteFile(enc, b, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := DecryptFile(key, enc, filepath.Join(dir, "out.bin")); err == nil {
		t.Fatal("expected integrity failure on tampered ciphertext")
	}
}

func TestDecryptWrongKeyFails(t *testing.T) {
	keyA := testKey(t)
	keyB := testKey(t)
	dir := t.TempDir()
	plain := filepath.Join(dir, "plain.bin")
	enc := filepath.Join(dir, "enc.bin")
	if err := os.WriteFile(plain, []byte("data"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := EncryptFile(keyA, plain, enc); err != nil {
		t.Fatal(err)
	}
	if err := DecryptFile(keyB, enc, filepath.Join(dir, "out.bin")); err == nil {
		t.Fatal("expected key mismatch error")
	}
}

func TestDecryptNotAContainerFails(t *testing.T) {
	key := testKey(t)
	dir := t.TempDir()
	plain := filepath.Join(dir, "plain.bin")
	if err := os.WriteFile(plain, []byte("this is not an encrypted backup"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := DecryptFile(key, plain, filepath.Join(dir, "out.bin")); err == nil {
		t.Fatal("expected container format error")
	}
}

func TestKeyIDStableAndDistinct(t *testing.T) {
	k1, k2 := testKey(t), testKey(t)
	if KeyID(k1) == KeyID(k2) {
		t.Fatal("different keys produced the same fingerprint")
	}
	if KeyID(k1) != KeyID(k1) {
		t.Fatal("fingerprint is not stable")
	}
}
