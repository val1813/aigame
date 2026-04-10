import React from 'react';
import { Box, Text } from 'ink';

export default function TopBar({ worldName, turn, elapsedMs, score, rank }) {
  const minutes = Math.floor((elapsedMs || 0) / 60000);
  const seconds = Math.floor(((elapsedMs || 0) % 60000) / 1000);
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return (
    <Box
      borderStyle="single"
      borderColor="#2A3A4A"
      paddingX={1}
      justifyContent="space-between"
    >
      <Text color="#DDEEFF" bold>AGENTWORLD</Text>
      {worldName && <Text color="#88AACC">  {worldName}</Text>}
      <Text color="#4A6A4A">  回合#{turn || 0}</Text>
      <Text color="#4A6A4A">  ⏱ {timeStr}</Text>
      {score != null && <Text color="#FFAA44">  ★{score.toFixed(1)}</Text>}
      {rank != null && <Text color="#AA88FF">  #{rank}</Text>}
    </Box>
  );
}
