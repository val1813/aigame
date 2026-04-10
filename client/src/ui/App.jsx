import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TopBar from './panels/TopBar.jsx';
import MapPanel from './panels/MapPanel.jsx';
import StatusPanel from './panels/StatusPanel.jsx';
import LogPanel from './panels/LogPanel.jsx';

export default function App({ gameState: initialState, onVipIntervene }) {
  const [state, setState] = useState(initialState.state);

  useEffect(() => {
    const handler = (newState) => setState({ ...newState });
    initialState.on('change', handler);
    return () => initialState.off('change', handler);
  }, [initialState]);

  const mapWidth = '70%';

  return (
    <Box flexDirection="column" height="100%">
      <TopBar
        worldName={state.worldName}
        turn={state.turn}
        elapsedMs={state.elapsedMs}
        score={state.score?.final_score}
      />
      <Box flexGrow={1}>
        <MapPanel
          map={state.map}
          fovCells={state.fovCells}
          exploredCells={state.exploredCells}
          playerPos={state.playerPos}
          width={mapWidth}
        />
        <StatusPanel
          agent={state.agent}
          currentNpc={state.currentNpc}
          vipAvailable={state.vipAvailable}
          turn={state.turn}
          elapsedMs={state.elapsedMs}
        />
      </Box>
      <LogPanel logs={state.logs} height={5} />
      {state.vipAvailable && onVipIntervene && (
        <VipInput onSubmit={onVipIntervene} />
      )}
    </Box>
  );
}

function VipInput({ onSubmit }) {
  const [input, setInput] = useState('');

  useInput((ch, key) => {
    if (key.return) {
      if (input.trim()) onSubmit(input.trim());
      return;
    }
    if (key.backspace || key.delete) {
      setInput(prev => prev.slice(0, -1));
      return;
    }
    if (ch && !key.ctrl && !key.meta) {
      setInput(prev => prev + ch);
    }
  });

  return (
    <Box borderStyle="single" borderColor="#AA88FF" paddingX={1} flexDirection="column">
      <Text color="#AA88FF">VIP干涉 — 输入提示（将作为额外上下文注入AI，本局进入VIP榜）：</Text>
      <Text color="#DDEEFF">&gt; {input}<Text color="#AA88FF">_</Text></Text>
    </Box>
  );
}
