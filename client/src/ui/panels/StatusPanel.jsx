import React from 'react';
import { Box, Text } from 'ink';

function Bar({ value, max = 100, width = 10, color = 'green' }) {
  const filled = Math.round((value / max) * width);
  const empty = width - filled;
  return (
    <Text>
      <Text color={color}>{'█'.repeat(Math.max(0, filled))}</Text>
      <Text color="#333333">{'░'.repeat(Math.max(0, empty))}</Text>
    </Text>
  );
}

export default function StatusPanel({ agent, currentNpc, vipAvailable, turn, elapsedMs }) {
  const minutes = Math.floor(elapsedMs / 60000);
  const seconds = Math.floor((elapsedMs % 60000) / 1000);
  const timeStr = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return (
    <Box flexDirection="column" paddingLeft={1} flexGrow={1}>
      <Text color="#4A6A4A">[ AI状态 ]</Text>
      {agent?.modelName && <Text color="#888888">{agent.modelName}</Text>}
      <Box>
        <Text color="#AAAAAA">HP  </Text>
        <Bar value={agent?.hp ?? 100} color="green" />
      </Box>
      <Box>
        <Text color="#AAAAAA">能量 </Text>
        <Bar value={agent?.energy ?? 100} color="cyan" />
      </Box>
      <Box>
        <Text color="#AAAAAA">进度 </Text>
        <Bar value={agent?.progress ?? 0} color="yellow" />
      </Box>
      <Text color="#4A6A4A">⏱ {timeStr}</Text>

      <Text> </Text>
      {currentNpc ? (
        <>
          <Text color="#4A6A4A">[ 当前NPC ]</Text>
          <Text color="#FFAA44">⚠ {currentNpc.name}</Text>
          {currentNpc.emotion && <Text color="#AAAAAA">情绪: {currentNpc.emotion}</Text>}
          {currentNpc.affinity != null && (
            <Text color="#AAAAAA">好感: {currentNpc.affinity}/100</Text>
          )}
        </>
      ) : (
        <Text color="#333333">[ 无NPC交互 ]</Text>
      )}

      <Text> </Text>
      <Text color="#4A6A4A">[ 背包 ]</Text>
      {agent?.inventory?.length > 0 ? (
        agent.inventory.map((item, i) => (
          <Text key={i} color="#44CCFF">◆ {item}</Text>
        ))
      ) : (
        <Text color="#333333">（空）</Text>
      )}

      {vipAvailable && (
        <>
          <Text> </Text>
          <Text color="#AA88FF">[ VIP干涉可用 ]</Text>
        </>
      )}
    </Box>
  );
}
