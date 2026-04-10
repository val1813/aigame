import React from 'react';
import { Box, Text } from 'ink';
import { LOG_COLORS } from '../utils/colors.js';

const PREFIX = {
  system: '',
  action: '> ',
  npc:    '',
  gain:   '+ ',
  damage: '! ',
  think:  '▌ ',
};

export default function LogPanel({ logs, height = 5 }) {
  const recent = (logs || []).slice(-height);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="#2A3A4A"
      paddingX={1}
      height={height + 2}
    >
      {recent.map((log, i) => (
        <Text key={i} color={LOG_COLORS[log.type] || '#AAAAAA'}>
          {log.turn != null ? `[T${log.turn}] ` : ''}
          {PREFIX[log.type] || ''}
          {log.text}
        </Text>
      ))}
    </Box>
  );
}
