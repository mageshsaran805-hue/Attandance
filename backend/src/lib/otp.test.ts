import { describe, expect, it } from 'vitest';
import { env } from '../config/env.js';
import { generateOtp, hashOtp, otpInputPattern, otpMatches } from './otp.js';

describe('otp helpers', () => {
  it('generates fixed-length numeric codes', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateOtp()).toMatch(new RegExp(`^\\d{${env.OTP_LENGTH}}$`));
    }
  });

  it('hashes deterministically without storing the raw value', () => {
    const otp = '975310';
    const hash = hashOtp(otp);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(otp);
    expect(hashOtp(otp)).toBe(hash);
  });

  it('matches only the exact code', () => {
    const otp = generateOtp();
    const hash = hashOtp(otp);
    expect(otpMatches(otp, hash)).toBe(true);
    const other = otp === '000000' ? '000001' : '000000';
    expect(otpMatches(other, hash)).toBe(false);
    expect(otpMatches('', hash)).toBe(false);
  });

  it('exposes a validation pattern for the configured length', () => {
    const pattern = otpInputPattern();
    expect(pattern.test('1'.repeat(env.OTP_LENGTH))).toBe(true);
    expect(pattern.test('1'.repeat(env.OTP_LENGTH + 1))).toBe(false);
    expect(pattern.test('a'.repeat(env.OTP_LENGTH))).toBe(false);
  });
});
