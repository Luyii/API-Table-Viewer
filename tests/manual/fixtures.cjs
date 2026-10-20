'use strict';
const cases = [
  ['ordinary', '普通对象数组 / 搜索 / 排序 / 列宽 / 导出'],
  ['nested', '嵌套及混合数组'],
  ['nodes', '单元格内 6,001 节点数组'],
  ['records', '50,000 条记录及末项定位'],
  ['integers', '超安全整数原文'],
  ['long-text', '长文本 / 分段 / 弹框竞争'],
  ['missing', '缺失、null、空字符串、空字段名']
].map(([id, title]) => ({id, title}));
function fixture(id) {
  switch (id) {
    case 'ordinary': return JSON.stringify(Array.from({length: 260}, (_, i) => ({
      id: i + 1, name: `中文用户-${i + 1}`, amount: [-12.5, 0, 2, 10, -2][i % 5],
      active: i % 2 === 0, note: [0, 124, 259].includes(i) ? 'TABLE-HIT' : `说明-${i}`,
      extra: i === 124 ? 'TABLE-HIT' : '', formula: i === 0 ? '=1+1' : '正常文本',
      escaped: i === 0 ? '中文,逗号 "引号"\n第二行|竖线' : ''
    })));
    case 'nested': return JSON.stringify({groups: [{name: 'A', items: [{id: 1, tags: ['红', '蓝']}, {id: 2, tags: []}]}], primitives: [1, '二', null, true], mixed: [{id: 1}, [2, 3], '四', null], empty: []});
    case 'nodes': return JSON.stringify([{id: 'node-container', payload: Array.from({length: 6000}, (_, i) => i === 5999 ? 'NODE-END-5999' : i)}]);
    case 'records': return JSON.stringify([{id: 'record-container', records: Array.from({length: 50000}, (_, i) => ({id: i + 1, name: `record-${i + 1}`, marker: i === 49999 ? 'RECORD-END-50000' : ''}))}]);
    // Never construct these literals as JavaScript Numbers.
    case 'integers': return '[{"id":9007199254740993,"amount":-12.5},{"id":9007199254740992,"amount":-2},{"id":9223372036854775807,"amount":0},{"id":-9223372036854775808,"amount":10},{"id":"9007199254740993","amount":"=1+1"}]';
    case 'long-text': return JSON.stringify([{id: 1, text: '甲'.repeat(12000) + 'PAGE-2-MARK' + '乙'.repeat(12000) + 'PAGE-3-MARK' + '丙'.repeat(12000)}, {id: 2, text: '头'.repeat(510000) + 'LONG-END'}]);
    case 'missing': return '[{"id":1,"optional":"present","nullable":null,"empty":"","":2},{"id":2,"":10},{"id":3,"optional":null,"nullable":"value","empty":"","":-1}]';
    default: return null;
  }
}
module.exports = {cases, fixture};
