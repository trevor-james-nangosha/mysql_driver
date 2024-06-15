import crypto from "node:crypto";

function xor(a: Buffer, b: Buffer) {
  const result = Buffer.allocUnsafe(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] ^ b[i];
  }
  return result;
}

function sha256(password: Buffer) {
  const hash = crypto.createHash("sha256");
  return hash.update(password).digest();
}

function sha1(password: Buffer) {
  const hash = crypto.createHash("sha1");
  return hash.update(password).digest();
}

function calculateTokenCaching256(password: string, scramble: string) {
  // SHA256( password ) XOR SHA256( "20-bytes random data from server" <concat> SHA256( SHA1( password ) ) )
  const stage1 = sha256(Buffer.from(password));
  const stage2 = sha256(stage1);
  const stage3 = sha256(Buffer.concat([stage2, Buffer.from(scramble)]))
  return xor(stage1, stage3);
}

function calculateTokenNativePassword(password: string, scramble: string) {
  // SHA1( password ) XOR SHA1( "20-bytes random data from server" <concat> SHA1( SHA1( password ) ) )
  const stage1 = sha1(Buffer.from(password));
  const stage2 = sha1(stage1);
  const stage3 = sha1(Buffer.concat([Buffer.from(scramble), stage2]))
  return xor(stage1, stage3);
}

export {calculateTokenCaching256, calculateTokenNativePassword};
