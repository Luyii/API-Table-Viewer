'use strict';
const fixtureCases = [
  ['ordinary', '普通数组 260 行'], ['nested', '嵌套 / 混合 / 空数组'],
  ['nodes', '超过 5,000 节点'], ['records', '50,000 条记录'],
  ['integers', '超安全整数'], ['long-text', '长文本 / 分段'], ['missing', '缺失字段 / 空键']
];
let requestSequence = 0;
async function sendFixture(id, options) {
  const seq = ++requestSequence;
  try {
    const response = await fetch(`/api/${id}?run=${seq}`, {cache: 'no-store', ...options});
    // Read text, not response.json(): the latter rounds unsafe integers.
    const raw = await response.text();
    document.querySelector('#log').textContent += `#${seq} ${options?.method || 'GET'} ${id} → ${response.status} / ${new TextEncoder().encode(raw).length} bytes\n${raw.slice(0, 300)}\n\n`;
  } catch (error) {document.querySelector('#log').textContent += `#${seq} ${id}: ${error.message}\n`;}
}
for (const [id, title] of fixtureCases) {
  const button = document.createElement('button'); button.textContent = title;
  button.addEventListener('click', () => sendFixture(id)); document.querySelector('#cases').append(button);
}
document.querySelector('#all').onclick = async function () {
  this.disabled = true;
  try {for (const [id] of fixtureCases) await sendFixture(id);} finally {this.disabled = false;}
};
document.querySelector('#echo').onclick = () => sendFixture('echo', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{"id":9007199254740993,"negative":-12.5,"text":"中文"}'});
document.querySelector('#plain').onclick = () => sendFixture('plain');
document.querySelector('#status').onclick = () => sendFixture('status');
document.querySelector('#clear').onclick = () => {document.querySelector('#log').textContent = '';};
