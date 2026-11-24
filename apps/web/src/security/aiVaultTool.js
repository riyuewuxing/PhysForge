// Combined at build time with the shared, dependency-free aiVault.ts module.
const providers = [
  ['DeepSeek', 'https://api.deepseek.com', 'deepseek-flash'],
  ['OpenAI', 'https://api.openai.com/v1', 'gpt-4o-mini'],
  ['硅基流动', 'https://api.siliconflow.cn/v1', 'deepseek-ai/DeepSeek-V4-Flash'],
  ['Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai', 'gemini-4-hydrogen'],
  ['自定义', '', '']
];
const el = id => document.getElementById(id);
const status = message => { el('status').textContent = message; };
const root = el('profiles');
let busy = false;
function addProfile(profile = {name: providers[0][0], baseUrl: providers[0][1], model: providers[0][2], apiKey: ''}) {
  if (root.children.length >= 20) return;
  const card = document.createElement('div');
  card.className = 'profile';
  const chooser = document.createElement('select');
  chooser.setAttribute('aria-label', '供应商模板');
  for (const p of providers) chooser.append(new Option(p[0], p[0]));
  chooser.value = providers.some(p => p[0] === profile.name) ? profile.name : '自定义';
  const grid = document.createElement('div');
  grid.className = 'grid';
  const fields = {};
  for (const [key, label, max, type] of [
    ['name','配置名称',80,'text'],['baseUrl','API Base URL',2048,'text'],
    ['model','模型名称',200,'text'],['apiKey','API Key',4096,'password']
  ]) {
    const wrap = document.createElement('label');
    wrap.textContent = label;
    const input = document.createElement('input');
    input.type = type; input.maxLength = max; input.autocomplete = 'off';
    input.dataset.field = key; input.value = profile[key];
    wrap.append(input); grid.append(wrap); fields[key] = input;
  }
  chooser.addEventListener('change', () => {
    const p = providers.find(p => p[0] === chooser.value);
    if (!p) return;
    fields.name.value = p[0]; fields.baseUrl.value = p[1]; fields.model.value = p[2]; fields.apiKey.value = '';
  });
  const remove = document.createElement('button');
  remove.type = 'button'; remove.textContent = '删除该配置';
  remove.addEventListener('click', () => { card.remove(); });
  card.append(chooser, grid, remove); root.append(card);
}
function clearForm() {
  root.replaceChildren(); addProfile();
  for (const id of ['password','confirm','old-password','import-file']) el(id).value = '';
  el('password').type = el('confirm').type = 'password';
}
function readProfiles() {
  return [...root.children].map(card => Object.fromEntries([...card.querySelectorAll('[data-field]')].map(input => [input.dataset.field, input.value])));
}
function setBusy(value) {
  busy = value;
  for (const control of document.querySelectorAll('button,input,select')) control.disabled = value;
}
el('add').addEventListener('click', () => addProfile());
el('clear').addEventListener('click', () => { clearForm(); status('表单已清空。'); });
el('random').addEventListener('click', () => {
  try { const p = generateVaultPassword(); el('password').value = el('confirm').value = p; status('随机恢复密码已生成，请显示并自行保管。'); }
  catch { status('当前浏览器不支持安全随机数。'); }
});
el('toggle').addEventListener('click', () => {
  const type = el('password').type === 'password' ? 'text' : 'password';
  el('password').type = el('confirm').type = type;
});
el('import').addEventListener('click', async () => {
  if (busy) return;
  const file = el('import-file').files?.[0];
  if (!file || file.size > VAULT_MAX_BYTES) { status('请选择有效的加密文件。'); return; }
  setBusy(true);
  try {
    const profiles = await decryptAiVault(await file.text(), el('old-password').value);
    root.replaceChildren(); profiles.forEach(addProfile);
    status('已在本地解密导入；修改后请重新加密下载。');
  } catch { status('导入失败：密码错误或文件不受支持。'); }
  finally { el('old-password').value = ''; el('import-file').value = ''; setBusy(false); }
});
el('encrypt').addEventListener('click', async () => {
  if (busy) return;
  const password = el('password').value;
  if (password !== el('confirm').value || password.length < 16) { status('请填写至少 16 字符的相同密码。'); return; }
  setBusy(true);
  try {
    const raw = await encryptAiVault(readProfiles(), password);
    const url = URL.createObjectURL(new Blob([raw], {type:'application/json'}));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'ai-vault.enc.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    clearForm(); status('加密文件已生成。表单已清空，请保存下载的密文和独立的主密码。');
  } catch { status('加密失败：请检查配置、密码和浏览器 Web Crypto 支持。'); }
  finally { setBusy(false); }
});
addProfile();
if (!globalThis.crypto?.subtle) { setBusy(true); status('此环境不支持 Web Crypto。请下载后在可信的现代浏览器中打开。'); }
