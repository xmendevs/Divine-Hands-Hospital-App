package auth

import "github.com/pquerna/otp/totp"

// GenerateTOTP returns a new TOTP secret and its otpauth provisioning URL.
func GenerateTOTP(issuer, account string) (secret, url string, err error) {
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      issuer,
		AccountName: account,
	})
	if err != nil {
		return "", "", err
	}
	return key.Secret(), key.URL(), nil
}

// VerifyTOTP validates a code against a base32 TOTP secret.
func VerifyTOTP(secret, code string) bool {
	return totp.Validate(code, secret)
}
