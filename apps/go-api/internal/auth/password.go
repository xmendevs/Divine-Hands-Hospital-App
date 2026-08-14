package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/argon2"
)

// Argon2id parameters.
const (
	argonTime    = 2
	argonMemory  = 64 * 1024 // 64 MiB
	argonThreads = 2
	argonKeyLen  = 32
	argonSaltLen = 16
)

var (
	ErrInvalidHash         = errors.New("invalid password hash format")
	ErrIncompatibleVersion = errors.New("incompatible argon2 version")
)

type argonParams struct {
	memory  uint32
	time    uint32
	threads uint8
}

// HashPassword returns an Argon2id password hash in PHC string format.
func HashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	return fmt.Sprintf(
		"$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemory, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key),
	), nil
}

// VerifyPassword reports whether password matches the stored Argon2id hash.
func VerifyPassword(hash, password string) (bool, error) {
	params, salt, key, err := decodeHash(hash)
	if err != nil {
		return false, err
	}
	other := argon2.IDKey([]byte(password), salt, params.time, params.memory, params.threads, uint32(len(key)))
	return subtle.ConstantTimeCompare(key, other) == 1, nil
}

func decodeHash(hash string) (argonParams, []byte, []byte, error) {
	var params argonParams
	parts := strings.Split(hash, "$")
	// ["", "argon2id", "v=19", "m=...,t=...,p=...", salt, key]
	if len(parts) != 6 || parts[1] != "argon2id" {
		return params, nil, nil, ErrInvalidHash
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return params, nil, nil, ErrIncompatibleVersion
	}
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &params.memory, &params.time, &params.threads); err != nil {
		return params, nil, nil, ErrInvalidHash
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return params, nil, nil, ErrInvalidHash
	}
	key, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return params, nil, nil, ErrInvalidHash
	}
	return params, salt, key, nil
}
