import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRecruitmentCrypto,
  decryptRecruitmentValue,
  deriveRecruitmentKey,
  encryptRecruitmentValue,
} from '../recruitment-crypto.js';

test('招募消息和联系方式使用隔离域密钥加密，密文不含原文', () => {
  const secret = 'test-session-secret';
  const message = '请直接加我 QQ 123456';
  const contact = JSON.stringify({ type: 'qq', value: '123456', label: '队长' });
  const service = createRecruitmentCrypto({ sessionSecret: secret });

  const encryptedMessage = service.encryptMessage(message);
  const encryptedContact = service.encryptContact(contact);

  assert.notEqual(encryptedMessage.ciphertext, message);
  assert.notEqual(encryptedContact.ciphertext, contact);
  assert.equal(service.decryptMessage(encryptedMessage), message);
  assert.equal(service.decryptContact(encryptedContact), contact);
  assert.notDeepEqual(deriveRecruitmentKey(secret, 'messages'), deriveRecruitmentKey(secret, 'contacts'));
});

test('跨域解密和篡改密文都会失败', () => {
  const secret = 'test-session-secret';
  const encrypted = encryptRecruitmentValue('private text', { sessionSecret: secret, domain: 'messages' });
  assert.throws(
    () => decryptRecruitmentValue(encrypted, { sessionSecret: secret, domain: 'contacts' }),
  );

  const tampered = { ...encrypted, ciphertext: `${encrypted.ciphertext.slice(0, -1)}A` };
  assert.throws(
    () => decryptRecruitmentValue(tampered, { sessionSecret: secret, domain: 'messages' }),
  );
});
