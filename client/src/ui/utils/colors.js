'use strict';

// 字符颜色语义映射（Cogmind 风格）
const CHAR_COLORS = {
  '@': '#FFFFFF',  // 玩家
  '#': '#3A4A5A',  // 墙壁
  '.': '#1E2E3E',  // 地板
  '+': '#C8A040',  // 门
  'f': '#FF6B6B',  // 敌对NPC
  'n': '#88CC88',  // 友好NPC
  '?': '#FFAA44',  // 未知NPC
  '%': '#44CCFF',  // 道具/线索
  '<': '#AA88FF',  // 关键地点
  '>': '#AA88FF',  // 出口
  '≈': '#2255AA',  // 水/障碍
};

const DIM_COLOR = '#2A3A4A';  // 已探索但不在视野内

// 消息类型颜色
const LOG_COLORS = {
  system:  '#4A6A4A',
  action:  '#88AACC',
  npc:     '#FFAA44',
  gain:    '#66CC88',
  damage:  '#FF6666',
  think:   '#DDEEFF',
};

module.exports = { CHAR_COLORS, DIM_COLOR, LOG_COLORS };
