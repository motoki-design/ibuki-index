#!/usr/bin/env node
/**
 * payload.json（平文・リポジトリ外）を合言葉で暗号化し、index.html を生成する。
 *
 *   IBUKI_PASS='合言葉' node build.js
 *
 * 暗号：PBKDF2-SHA256（250,000回）で鍵を導出し AES-256-GCM。
 * 生成される index.html には暗号文しか入らないので、GitHubで公開しても
 * 合言葉を知らない人にはファイル名・分野・DriveのファイルIDのいずれも読めない。
 *
 * ★守れないもの：Driveの共有設定そのもの。リンクを開けるかどうかはDrive側の権限で決まる。
 *   合言葉は「どんな資料が何件あるか」を隠すためのもので、原本のアクセス制御ではない。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ITER = 250000;
// payload.json の場所。優先順は 環境変数 → config.local.json → このリポジトリの1つ上。
// ★config.local.json は .gitignore 済みだが、**gitignore は Dropbox の同期を止めない**。
//   梭のMacで書いた /Users/moriyamamotoki/... が会社PCへ降りてきて build が落ちた（2026-09-07）。
//   そこで「書いてあるが、この端末には無いパス」は既定へ落とす。
//   既定＝リポジトリの1つ上＝平文の payload.json の定位置。端末ごとの設定は要らなくなる。
const FALLBACK = path.join(__dirname, '..', 'payload.json');
const PAYLOAD = (function () {
  if (process.env.IBUKI_PAYLOAD) return process.env.IBUKI_PAYLOAD;
  try {
    const p = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.local.json'), 'utf8')).payloadPath;
    if (p && fs.existsSync(p)) return p;
    if (p) console.error('[build] config.local.json の payloadPath がこの端末に無いので既定を使います:'
                         + String.fromCharCode(10) + '        ' + p);
  } catch (e) { /* 無ければ既定へ落とす */ }
  return FALLBACK;
})();
const TEMPLATE = path.join(__dirname, 'template.html');
const OUT = path.join(__dirname, 'index.html');

const pass = process.env.IBUKI_PASS;
if (!pass) {
  console.error('合言葉が指定されていません。\n  IBUKI_PASS=\'合言葉\' node build.js');
  process.exit(1);
}
if (!fs.existsSync(PAYLOAD)) {
  console.error('payload.json が見つかりません:', PAYLOAD);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(PAYLOAD, 'utf8'));
delete data._について; // 生成物には運用メモを載せない

const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);
const key = crypto.pbkdf2Sync(Buffer.from(pass, 'utf8'), salt, ITER, 32, 'sha256');
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const ct = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
const tag = cipher.getAuthTag();

const blob = {
  v: 1,
  kdf: { name: 'PBKDF2', hash: 'SHA-256', iter: ITER, salt: salt.toString('base64') },
  iv: iv.toString('base64'),
  // WebCrypto の AES-GCM は暗号文の末尾に認証タグが付いている前提なので連結して渡す
  ct: Buffer.concat([ct, tag]).toString('base64'),
};

const tpl = fs.readFileSync(TEMPLATE, 'utf8');
if (!tpl.includes('/*__BLOB__*/null')) {
  console.error('template.html に差込位置 /*__BLOB__*/null がありません');
  process.exit(1);
}
const built = tpl
  .replace('/*__BLOB__*/null', JSON.stringify(blob))
  .replace('/*__BUILT_AT__*/""', JSON.stringify(
    new Date().toLocaleString('ja-JP', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })));

fs.writeFileSync(OUT, built, 'utf8');
console.log(`生成: ${OUT}`);
console.log(`  平文 ${JSON.stringify(data).length} バイト → 暗号文 ${blob.ct.length} バイト（base64）`);
console.log(`  索引 ${(data.rows || []).length} 件／Drive未登録 ${(data.ask || []).length} 件`);
console.log('→ git add index.html && git commit && git push で公開されます');
