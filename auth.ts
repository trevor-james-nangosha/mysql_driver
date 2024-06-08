import crypto from "node:crypto";

// https://github.com/sidorares/node-mysql2/blob/9ac9f7760fd2fac49b006df80283cfa9332e0f63/lib/auth_plugins/caching_sha2_password.js

function xor(a, b) {
  const result = Buffer.allocUnsafe(a.length);
  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] ^ b[i];
  }
  return result;
}

function xorRotating(a, seed) {
  const result = Buffer.allocUnsafe(a.length);
  const seedLen = seed.length;

  for (let i = 0; i < a.length; i++) {
    result[i] = a[i] ^ seed[i % seedLen];
  }
  return result;
}

function sha256(password) {
  const hash = crypto.createHash("sha256");
  return hash.update(password).digest();
}

function calculateToken(password: string, scramble: string) {
  console.log("Password length: ", password.length)
  console.log("Scramble length: ", scramble.length)
  // SHA1( password ) XOR SHA1( "20-bytes random data from server" <concat> SHA1( SHA1( password ) ) )
  // let's do it from the end
  const stage1 = sha256(Buffer.from(password));
  const stage2 = sha256(stage1);
  const stage3 = sha256(Buffer.concat([stage2, Buffer.from(scramble)])); // do not forget to concat the two parts of the scramble
  console.log("Encrypted password length: ", xor(stage1, stage3).length)
  return xor(stage1, stage3);
}

function encrypt(password, scramble, key) {
  const stage1 = xorRotating(Buffer.from(password, "utf8"), scramble); // should we null terminate the password???
  return crypto.publicEncrypt(
    {
      key,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
    },
    stage1
  );
}

export default calculateToken;
