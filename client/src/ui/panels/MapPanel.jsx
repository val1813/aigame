import React from 'react';
import { Box, Text } from 'ink';
import { CHAR_COLORS, DIM_COLOR } from '../utils/colors.js';

export default function MapPanel({ map, fovCells, exploredCells, playerPos, width }) {
  if (!map || !map.tiles) {
    return (
      <Box width={width} flexDirection="column" justifyContent="center" alignItems="center">
        <Text color="#4A6A4A">等待游戏开始...</Text>
      </Box>
    );
  }

  const rows = map.tiles;

  return (
    <Box width={width} flexDirection="column" overflow="hidden">
      {rows.map((row, y) => (
        <Box key={y} flexDirection="row">
          {[...row].map((ch, x) => {
            const key = `${x},${y}`;
            const inFov = fovCells && fovCells.has(key);
            const explored = exploredCells && exploredCells.has(key);

            if (!inFov && !explored) {
              return <Text key={x}> </Text>;
            }

            const isPlayer = playerPos && playerPos.x === x && playerPos.y === y;
            const displayCh = isPlayer ? '@' : ch;
            const baseColor = CHAR_COLORS[displayCh] || '#AAAAAA';
            const color = inFov ? baseColor : DIM_COLOR;

            return (
              <Text key={x} color={color}>
                {displayCh === '.' ? '·' : displayCh}
              </Text>
            );
          })}
        </Box>
      ))}
    </Box>
  );
}
