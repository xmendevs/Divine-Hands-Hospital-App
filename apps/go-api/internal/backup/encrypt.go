// Package backup implements the Phase 13 backup & disaster recovery service:
// encrypted local and cloud backups, tiered retention, and isolated restore
// verification. Backups are encrypted with AES-256-GCM before they touch disk
// or the network; the encryption key is supplied separately from application
// credentials.
package backup

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
)

const fileMagic = "DHHB1" // identifies an encrypted backup container

// EncryptedFile layout: magic(5) | keyID(16 hex chars) | nonce(12) | ciphertext+tag.
const (
	magicLen  = len(fileMagic)
	keyIDLen  = 16 // hex-encoded fingerprint length
	nonceLen  = 12
	headerLen = magicLen + keyIDLen + nonceLen
)

var errBadContainer = errors.New("not an encrypted backup container")

// KeyID returns a short fingerprint of the encryption key so mismatched keys
// are detected before decryption.
func KeyID(key []byte) string {
	sum := sha256.Sum256(key)
	return hex.EncodeToString(sum[:keyIDLen/2])
}

// EncryptFile encrypts src into dst with AES-256-GCM under key (32 bytes).
func EncryptFile(key []byte, src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	if err := encryptStream(key, in, out); err != nil {
		return err
	}
	return out.Close()
}

func encryptStream(key []byte, src io.Reader, dst io.Writer) error {
	if len(key) != 32 {
		return errors.New("backup encryption key must be 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}

	nonce := make([]byte, nonceLen)
	if _, err := rand.Read(nonce); err != nil {
		return err
	}
	if _, err := dst.Write([]byte(fileMagic)); err != nil {
		return err
	}
	if _, err := dst.Write([]byte(KeyID(key))); err != nil {
		return err
	}
	if _, err := dst.Write(nonce); err != nil {
		return err
	}

	plain, err := io.ReadAll(src)
	if err != nil {
		return err
	}
	sealed := gcm.Seal(nil, nonce, plain, []byte(fileMagic))
	_, err = dst.Write(sealed)
	return err
}

// DecryptFile decrypts src into dst, verifying the key fingerprint and the
// GCM authentication tag.
func DecryptFile(key []byte, src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	if err := decryptStream(key, in, out); err != nil {
		return err
	}
	return out.Close()
}

func decryptStream(key []byte, src io.Reader, dst io.Writer) error {
	if len(key) != 32 {
		return errors.New("backup encryption key must be 32 bytes")
	}
	header := make([]byte, headerLen)
	if _, err := io.ReadFull(src, header); err != nil {
		return err
	}
	if string(header[:magicLen]) != fileMagic {
		return errBadContainer
	}
	if string(header[magicLen:magicLen+keyIDLen]) != KeyID(key) {
		return errors.New("backup encryption key mismatch")
	}
	nonce := header[magicLen+keyIDLen:]

	block, err := aes.NewCipher(key)
	if err != nil {
		return err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}

	sealed, err := io.ReadAll(src)
	if err != nil {
		return err
	}
	plain, err := gcm.Open(nil, nonce, sealed, []byte(fileMagic))
	if err != nil {
		return fmt.Errorf("backup integrity check failed: %w", err)
	}
	_, err = dst.Write(plain)
	return err
}
