"""
AES-256-GCM 加密工具 — Python 版
用于服务端加密/解密关卡场景数据，按回合下发给客户端。
"""
import hashlib
import hmac
import json
import os
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def derive_session_key(master_key: bytes, session_id: str) -> bytes:
    """用 HMAC-SHA256 从 master_key 派生 session 级密钥"""
    return hmac.new(master_key, session_id.encode(), hashlib.sha256).digest()


def generate_master_key() -> bytes:
    """生成 32 字节随机 master key"""
    return os.urandom(32)


def encrypt_node(plaintext: dict, key: bytes) -> str:
    """
    AES-256-GCM 加密场景节点。
    返回格式: base64(nonce) ~ base64(ciphertext+tag)
    """
    import base64
    nonce = os.urandom(12)
    aesgcm = AESGCM(key)
    ct = aesgcm.encrypt(nonce, json.dumps(plaintext, ensure_ascii=False).encode(), None)
    return base64.b64encode(nonce).decode() + '~' + base64.b64encode(ct).decode()


def decrypt_node(ciphertext: str, key: bytes) -> dict:
    """解密 encrypt_node 产出的密文"""
    import base64
    parts = ciphertext.split('~')
    nonce = base64.b64decode(parts[0])
    ct = base64.b64decode(parts[1])
    aesgcm = AESGCM(key)
    plain = aesgcm.decrypt(nonce, ct, None)
    return json.loads(plain.decode())
