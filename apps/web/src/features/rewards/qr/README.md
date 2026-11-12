# Rewards: pickup code

- `qr.ts`: a QR encoder (byte mode, error correction level M, versions 1 to 40), so the signed
  pickup code needs no third-party package.
- `QrCode.tsx`: the code as SVG, dark on white in both themes, so any scanner reads it.

Tested in `apps/web/tests/rewards.test.ts`, and read back with macOS's own reader (Vision) on
codes of versions 1, 7 and 13.
