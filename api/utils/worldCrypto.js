'use strict';
const crypto = require('crypto');

/**
 * AES-256-GCM world content encryption utilities.
 * Uses Node.js built-in crypto — no third-party deps.
 */

/**
 * Derive a per-session key from the world's master key using HMAC-SHA256.
 * @param {Buffer|string} masterKey - 32-byte master key (hex string or Buffer)
 * @param {string} sessionId
 * @returns {Buffer} 32-byte session key
 */
function deriveSessionKey(masterKey, sessionId) {
  const key = typeof masterKey === 'string' ? Buffer.from(masterKey, 'hex') : masterKey;
  return crypto.createHmac('sha256', key).update(sessionId).digest();
}

/**
 * Encrypt a node/scene object with AES-256-GCM.
 * @param {object} plaintext
 * @param {Buffer} key - 32-byte session key
 * @returns {string} "base64(enc)~base64(iv)~base64(authTag)"
 */
function encryptNode(plaintext, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([
    cipher.update(JSON.stringify(plaintext), 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [enc, iv, authTag].map(b => b.toString('base64')).join('~');
}

/**
 * Decrypt a node/scene string produced by encryptNode.
 * @param {string} ciphertext
 * @param {Buffer} key - 32-byte session key
 * @returns {object}
 */
function decryptNode(ciphertext, key) {
  const [enc, iv, authTag] = ciphertext.split('~').map(s => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  return JSON.parse(plain);
}

module.exports = { deriveSessionKey, encryptNode, decryptNode };
