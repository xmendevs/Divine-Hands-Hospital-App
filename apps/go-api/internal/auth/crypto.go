package auth

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
)

// Cipher encrypts and decrypts secrets at rest using AES-256-GCM.
type Cipher struct {
	aead cipher.AEAD
}

// NewCipherFromHex builds a Cipher from a hex-encoded 32-byte key.
func NewCipherFromHex(hexKey string) (*Cipher, error) {
	if hexKey == "" {
		return nil, errors.New("encryption key is empty")
	}
	key, err := hex.DecodeString(hexKey)
	if err != nil {
		return nil, errors.New("encryption key is not valid hex")
	}
	if len(key) != 32 {
		return nil, errors.New("encryption key must be 32 bytes")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	return &Cipher{aead: aead}, nil
}

// Encrypt returns nonce || ciphertext.
func (c *Cipher) Encrypt(plain []byte) ([]byte, error) {
	nonce := make([]byte, c.aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}
	return c.aead.Seal(nonce, nonce, plain, nil), nil
}

// Decrypt reverses Encrypt.
func (c *Cipher) Decrypt(blob []byte) ([]byte, error) {
	ns := c.aead.NonceSize()
	if len(blob) < ns {
		return nil, errors.New("ciphertext too short")
	}
	nonce, ct := blob[:ns], blob[ns:]
	return c.aead.Open(nil, nonce, ct, nil)
}
