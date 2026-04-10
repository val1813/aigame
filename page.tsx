'use client'
import { useState, useEffect, useCallback } from 'react'

const API = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:9000'

function getToken() {
  return typeof window !== 'undefined' ? localStorage.getItem('gm_token') || '' : ''
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface NPC {
  id: string; name: string; type: 'scripted' | 'llm'
  position: { x: number; y: number }
  is_key_npc: boolean; key_npc_weight: number; alive: boolean
  llm_system_prompt?: string; llm_memory_window?: number
  npc_responses?: { idle?: string; default?: string }
}

interface QuestNode {
  id: string; name: string
  prerequisites: string[]
  complete_condition: string
  is_critical_path: boolean
  is_hidden: boolean
  anti_cheat_lock: boolean
}

interface WorldConfig {
  meta: {
    name: string; difficulty: string; description: string
    background_story: string; time_limit_ms: number
    world_time: string; weather: string; tags: string[]
    is_vip_required: boolean
  }
  map: {
    width: number; height: number; tiles: string[]
    legend: Record<string, string>; fov_radius: number
    spawn_point: { x: number; y: number }
  }
  npcs: NPC[]
  win_conditions: string[]
  fail_conditions: string[]
  scoring: {
    baseline_time_ms: number; baseline_tokens: number
    hidden_events_total: number; critical_nodes_total: number
  }
  quests: {
    main_quest: { id: string; name: string; nodes: Record<string, QuestNode> }
  }
}

function defaultConfig(): WorldConfig {
  return {
    meta: {
      name: '新关卡', difficulty: 'B', description: '',
      background_story: '', time_limit_ms: 1800000,
      world_time: '23:00', weather: '霓虹雨夜', tags: [],
      is_vip_required: false,
    },
    map: {
      width: 40, height: 10,
      tiles: [
        '########################################',
        '#......................................#',
        '#......@...............................#',
        '#......................................#',
        '#..................n...................#',
        '#......................................#',
        '#.................%....................#',
        '#......................................#',
        '#......................................>',
        '########################################',
      ],
      legend: { '@': '玩家起点', 'n': 'NPC位置', '%': '道具位置', '>': '出口' },
      fov_radius: 8,
      spawn_point: { x: 7, y: 2 },
    },
    npcs: [],
    win_conditions: ['quest.main_quest.node_end.complete == true'],
    fail_conditions: ['player.hp <= 0', 'session.elapsed_ms >= 1800000'],
    scoring: {
      baseline_time_ms: 480000, baseline_tokens: 4000,
      hidden_events_total: 0, critical_nodes_total: 1,
    },
    quests: {
      main_quest: {
        id: 'main_quest', name: '主线任务',
        nodes: {
          node_start: {
            id: 'node_start', name: '开始', prerequisites: [],
            complete_condition: 'session.turn >= 1',
            is_critical_path: true, is_hidden: false, anti_cheat_lock: false,
          },
        },
      },
    },
  }
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

type Tab = 'meta' | 'map' | 'npcs' | 'quests' | 'scoring' | 'json'

// ─── Main Component ───────────────────────────────────────────────────────────

export default function WorldEditor({ params }: { params: { id: string } }) {
  const [config, setConfig] = useState<WorldConfig>(defaultConfig())
  const [rawJson, setRawJson] = useState('')
  const [jsonError, setJsonError] = useState('')
  const [tab, setTab] = useState<Tab>('meta')
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [worldName, setWorldName] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadWorld() }, [])

  // sync config → rawJson when switching to json tab
  useEffect(() => {
    if (tab === 'json') setRawJson(JSON.stringify(config, null, 2))
  }, [tab])

  async function loadWorld() {
    setLoading(true)
    try {
      const r = await fetch(`${API}/gm/worlds`, { headers: { Authorization: `Bearer ${getToken()}` } })
      const data = await r.json()
      if (data.ok) {
        const w = data.data.find((x: any) => x.id === params.id)
        if (w) {
          setWorldName(w.name)
          const cfg = w.config && Object.keys(w.config).length > 0
            ? { ...defaultConfig(), ...w.config }
            : defaultConfig()
          setConfig(cfg)
        }
      }
    } finally { setLoading(false) }
  }

  function patchConfig(patch: Partial<WorldConfig>) {
    setConfig(prev => ({ ...prev, ...patch }))
  }
  function patchMeta(patch: Partial<WorldConfig['meta']>) {
    setConfig(prev => ({ ...prev, meta: { ...prev.meta, ...patch } }))
  }
  function patchMap(patch: Partial<WorldConfig['map']>) {
    setConfig(prev => ({ ...prev, map: { ...prev.map, ...patch } }))
  }
  function patchScoring(patch: Partial<WorldConfig['scoring']>) {
    setConfig(prev => ({ ...prev, scoring: { ...prev.scoring, ...patch } }))
  }

  async function save() {
    setSaveError(''); setJsonError('')
    let finalConfig = config

    if (tab === 'json') {
      try {
        finalConfig = JSON.parse(rawJson)
        setConfig(finalConfig)
      } catch {
        setJsonError('JSON格式错误，请检查')
        return
      }
    }

    const r = await fetch(`${API}/gm/worlds/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ config: finalConfig }),
    })
    const data = await r.json()
    if (data.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000) }
    else setSaveError('保存失败')
  }

  async function publish() {
    await save()
    const r = await fetch(`${API}/gm/worlds/${params.id}/publish`, {
      method: 'POST', headers: { Authorization: `Bearer ${getToken()}` },
    })
    const d = await r.json()
    if (d.ok) alert('✅ 发布成功！关卡已上线。')
    else alert('发布失败：' + JSON.stringify(d))
  }

  if (loading) return <div style={S.loading}>载入中...</div>

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={S.header}>
        <a href="/" style={S.back}>← 返回</a>
        <div style={S.headerCenter}>
          <span style={S.dot} />
          <span style={S.headerTitle}>{worldName || config.meta.name}</span>
          <span style={S.headerSub}>{params.id}</span>
        </div>
        <div style={S.headerActions}>
          {saved && <span style={S.savedBadge}>✓ 已保存</span>}
          {saveError && <span style={S.errBadge}>{saveError}</span>}
          <button onClick={save} style={S.btnSave}>保存</button>
          <button onClick={publish} style={S.btnPublish}>发布上线</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={S.tabs}>
        {([
          ['meta', '基本信息'],
          ['map', '地图编辑'],
          ['npcs', 'NPC配置'],
          ['quests', '任务节点'],
          ['scoring', '评分设置'],
          ['json', '原始JSON'],
        ] as [Tab, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ ...S.tab, ...(tab === key ? S.tabActive : {}) }}>
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={S.content}>
        {tab === 'meta' && <MetaTab meta={config.meta} onChange={patchMeta} />}
        {tab === 'map' && <MapTab map={config.map} onChange={patchMap} />}
        {tab === 'npcs' && <NpcsTab npcs={config.npcs} onChange={npcs => patchConfig({ npcs })} />}
        {tab === 'quests' && (
          <QuestsTab
            quest={config.quests.main_quest}
            onChange={q => patchConfig({ quests: { main_quest: q } })}
          />
        )}
        {tab === 'scoring' && (
          <ScoringTab
            scoring={config.scoring}
            winConds={config.win_conditions}
            failConds={config.fail_conditions}
            onChange={patchScoring}
            onWin={w => patchConfig({ win_conditions: w })}
            onFail={f => patchConfig({ fail_conditions: f })}
          />
        )}
        {tab === 'json' && (
          <JsonTab value={rawJson} onChange={setRawJson} error={jsonError} />
        )}
      </div>
    </div>
  )
}

// ─── Meta Tab ─────────────────────────────────────────────────────────────────

function MetaTab({ meta, onChange }: { meta: WorldConfig['meta']; onChange: (p: any) => void }) {
  return (
    <div style={S.form}>
      <Row label="关卡名称" hint="玩家在排行榜看到的名字">
        <input style={S.input} value={meta.name} onChange={e => onChange({ name: e.target.value })} />
      </Row>
      <Row label="难度" hint="S/A/B/C/D">
        <select style={S.select} value={meta.difficulty} onChange={e => onChange({ difficulty: e.target.value })}>
          {['S', 'A', 'B', 'C', 'D'].map(d => <option key={d}>{d}</option>)}
        </select>
      </Row>
      <Row label="需要VIP" hint="含LLM-NPC的关卡建议开启">
        <label style={S.toggle}>
          <input type="checkbox" checked={meta.is_vip_required}
            onChange={e => onChange({ is_vip_required: e.target.checked })} />
          <span style={{ marginLeft: 8, color: meta.is_vip_required ? '#aa88ff' : '#666' }}>
            {meta.is_vip_required ? '仅VIP可玩' : '所有人可玩'}
          </span>
        </label>
      </Row>
      <Row label="简介" hint="排行榜展示，1-2句话">
        <textarea style={{ ...S.input, height: 72, resize: 'vertical' }}
          value={meta.description} onChange={e => onChange({ description: e.target.value })} />
      </Row>
      <Row label="背景故事" hint="游戏开始时AI读取，设定世界观">
        <textarea style={{ ...S.input, height: 160, resize: 'vertical', fontFamily: 'monospace', fontSize: 13 }}
          value={meta.background_story} onChange={e => onChange({ background_story: e.target.value })} />
      </Row>
      <Row label="世界时间" hint="如 23:00、黎明">
        <input style={{ ...S.input, width: 120 }} value={meta.world_time}
          onChange={e => onChange({ world_time: e.target.value })} />
      </Row>
      <Row label="天气氛围" hint="如 霓虹雨夜、阴云密布">
        <input style={S.input} value={meta.weather} onChange={e => onChange({ weather: e.target.value })} />
      </Row>
      <Row label="总时限（分钟）" hint="超时则失败">
        <input style={{ ...S.input, width: 100 }} type="number"
          value={Math.round(meta.time_limit_ms / 60000)}
          onChange={e => onChange({ time_limit_ms: Number(e.target.value) * 60000 })} />
      </Row>
      <Row label="标签" hint="用逗号分隔，如：都市玄幻,侦探">
        <input style={S.input} value={meta.tags.join(',')}
          onChange={e => onChange({ tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />
      </Row>
    </div>
  )
}

// ─── Map Tab ──────────────────────────────────────────────────────────────────

function MapTab({ map, onChange }: { map: WorldConfig['map']; onChange: (p: any) => void }) {
  const CHAR_COLORS: Record<string, string> = {
    '#': '#3a4a5a', '.': '#1e3040', '+': '#c8a040', 'f': '#ff6b6b',
    'n': '#88cc88', '?': '#ffaa44', '%': '#44ccff', '<': '#aa88ff',
    '>': '#aa88ff', '≈': '#2255aa', '@': '#ffffff',
  }

  function updateTile(y: number, x: number, ch: string) {
    const tiles = [...map.tiles]
    const row = tiles[y] ? [...tiles[y]] : []
    row[x] = ch
    tiles[y] = row.join('')
    onChange({ tiles })
  }

  const [paintChar, setPaintChar] = useState('#')
  const [isDragging, setIsDragging] = useState(false)

  const handleCellInteract = useCallback((y: number, x: number) => {
    updateTile(y, x, paintChar)
  }, [paintChar, map.tiles])

  return (
    <div style={S.form}>
      {/* Legend */}
      <Row label="图例说明" hint="字符 → 含义，帮助GM理解地图">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Object.entries(map.legend).map(([ch, desc]) => (
            <div key={ch} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ ...S.charBadge, color: CHAR_COLORS[ch] || '#aaa' }}>{ch}</span>
              <input style={{ ...S.input, flex: 1 }} value={desc}
                onChange={e => onChange({ legend: { ...map.legend, [ch]: e.target.value } })} />
              <button style={S.btnDanger} onClick={() => {
                const l = { ...map.legend }; delete l[ch]; onChange({ legend: l })
              }}>✕</button>
            </div>
          ))}
          <button style={S.btnAdd} onClick={() => {
            const ch = prompt('输入字符（单个字母）') || ''; if (!ch) return
            onChange({ legend: { ...map.legend, [ch]: '描述' } })
          }}>+ 添加图例</button>
        </div>
      </Row>

      <Row label="FOV视野半径" hint="AI能看到的格子半径，默认8">
        <input style={{ ...S.input, width: 80 }} type="number" value={map.fov_radius}
          onChange={e => onChange({ fov_radius: Number(e.target.value) })} />
      </Row>

      <Row label="出生点" hint="玩家(@)的初始坐标">
        <div style={{ display: 'flex', gap: 8 }}>
          <span style={{ color: '#666' }}>X</span>
          <input style={{ ...S.input, width: 60 }} type="number" value={map.spawn_point.x}
            onChange={e => onChange({ spawn_point: { ...map.spawn_point, x: Number(e.target.value) } })} />
          <span style={{ color: '#666' }}>Y</span>
          <input style={{ ...S.input, width: 60 }} type="number" value={map.spawn_point.y}
            onChange={e => onChange({ spawn_point: { ...map.spawn_point, y: Number(e.target.value) } })} />
        </div>
      </Row>

      {/* Tile painter */}
      <div style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <span style={S.label}>地图绘制</span>
          <span style={{ color: '#555', fontSize: 12 }}>选择字符后点击格子绘制（可拖拽）</span>
        </div>
        {/* Palette */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {['#', '.', '+', 'n', 'f', '?', '%', '<', '>', '≈', '@', ' '].map(ch => (
            <button key={ch} onClick={() => setPaintChar(ch)}
              style={{
                width: 32, height: 32, background: paintChar === ch ? '#1a2a3a' : '#0d1520',
                border: `1px solid ${paintChar === ch ? '#44ccff' : '#2a3a4a'}`,
                color: CHAR_COLORS[ch] || '#888', borderRadius: 4, cursor: 'pointer',
                fontFamily: 'monospace', fontSize: 14, fontWeight: 'bold',
              }}>
              {ch === ' ' ? '⬜' : ch}
            </button>
          ))}
          <span style={{ color: '#555', fontSize: 12, alignSelf: 'center', marginLeft: 8 }}>
            当前: <span style={{ color: CHAR_COLORS[paintChar] || '#aaa', fontFamily: 'monospace' }}>
              {paintChar === ' ' ? '空格' : paintChar}
            </span>
          </span>
        </div>
        {/* Grid */}
        <div style={{ overflowX: 'auto', background: '#050a10', borderRadius: 6, padding: 8, border: '1px solid #1a2a3a' }}
          onMouseLeave={() => setIsDragging(false)}>
          {map.tiles.map((row, y) => (
            <div key={y} style={{ display: 'flex', height: 18 }}>
              {[...row.padEnd(map.width, ' ')].map((ch, x) => (
                <div key={x}
                  style={{
                    width: 14, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: CHAR_COLORS[ch] || '#333', fontFamily: 'monospace', fontSize: 12,
                    cursor: 'crosshair', userSelect: 'none',
                    background: ch === '#' ? '#0d1a26' : 'transparent',
                  }}
                  onMouseDown={() => { setIsDragging(true); handleCellInteract(y, x) }}
                  onMouseEnter={() => { if (isDragging) handleCellInteract(y, x) }}
                  onMouseUp={() => setIsDragging(false)}>
                  {ch === ' ' ? '' : ch === '.' ? '·' : ch}
                </div>
              ))}
            </div>
          ))}
        </div>
        {/* Row controls */}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button style={S.btnAdd} onClick={() => onChange({ tiles: [...map.tiles, '#'.repeat(map.width)] })}>
            + 添加行
          </button>
          <button style={S.btnDanger} onClick={() => {
            if (map.tiles.length > 1) onChange({ tiles: map.tiles.slice(0, -1) })
          }}>- 删除末行</button>
        </div>
      </div>

      {/* Raw tiles fallback */}
      <div style={{ marginTop: 16 }}>
        <div style={{ color: '#555', fontSize: 12, marginBottom: 6 }}>原始地图文本（可直接编辑）</div>
        <textarea style={{ ...S.input, fontFamily: 'monospace', fontSize: 12, height: 200, resize: 'vertical' }}
          value={map.tiles.join('\n')}
          onChange={e => onChange({ tiles: e.target.value.split('\n'), height: e.target.value.split('\n').length })} />
      </div>
    </div>
  )
}

// ─── NPCs Tab ─────────────────────────────────────────────────────────────────

function NpcsTab({ npcs, onChange }: { npcs: NPC[]; onChange: (n: NPC[]) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null)

  function addNpc() {
    const id = `npc_${Date.now()}`
    onChange([...npcs, {
      id, name: '新NPC', type: 'scripted',
      position: { x: 10, y: 5 }, is_key_npc: false,
      key_npc_weight: 0.5, alive: true,
    }])
    setExpanded(id)
  }

  function updateNpc(idx: number, patch: Partial<NPC>) {
    const next = [...npcs]; next[idx] = { ...next[idx], ...patch }; onChange(next)
  }

  function removeNpc(idx: number) {
    onChange(npcs.filter((_, i) => i !== idx))
  }

  return (
    <div style={S.form}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <span style={{ color: '#888', fontSize: 13 }}>共 {npcs.length} 个NPC</span>
        <button style={S.btnAdd} onClick={addNpc}>+ 添加NPC</button>
      </div>

      {npcs.length === 0 && (
        <div style={S.emptyHint}>
          还没有NPC。点击上方按钮添加。<br />
          <span style={{ fontSize: 12, color: '#444' }}>脚本型NPC按状态机运行；LLM型NPC由AI驱动对话（需VIP关卡）</span>
        </div>
      )}

      {npcs.map((npc, idx) => (
        <div key={npc.id} style={S.card}>
          <div style={S.cardHeader} onClick={() => setExpanded(expanded === npc.id ? null : npc.id)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ ...S.typeBadge, background: npc.type === 'llm' ? '#1a0a3a' : '#0a1a1a', color: npc.type === 'llm' ? '#aa88ff' : '#44cc88' }}>
                {npc.type === 'llm' ? 'LLM' : '脚本'}
              </span>
              <span style={{ color: '#ddeeff', fontWeight: 500 }}>{npc.name}</span>
              <span style={{ color: '#444', fontSize: 12 }}>({npc.id})</span>
              {npc.is_key_npc && <span style={{ ...S.typeBadge, background: '#1a1500', color: '#ffcc44' }}>关键NPC</span>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={S.btnDanger} onClick={e => { e.stopPropagation(); removeNpc(idx) }}>删除</button>
              <span style={{ color: '#444' }}>{expanded === npc.id ? '▲' : '▼'}</span>
            </div>
          </div>

          {expanded === npc.id && (
            <div style={{ padding: '12px 16px', borderTop: '1px solid #1a2a3a', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <InlineField label="ID（唯一标识）">
                  <input style={S.input} value={npc.id}
                    onChange={e => updateNpc(idx, { id: e.target.value })} />
                </InlineField>
                <InlineField label="显示名称">
                  <input style={S.input} value={npc.name}
                    onChange={e => updateNpc(idx, { name: e.target.value })} />
                </InlineField>
                <InlineField label="类型">
                  <select style={S.select} value={npc.type}
                    onChange={e => updateNpc(idx, { type: e.target.value as 'scripted' | 'llm' })}>
                    <option value="scripted">脚本型（规则驱动）</option>
                    <option value="llm">LLM型（AI驱动）- 需VIP</option>
                  </select>
                </InlineField>
                <InlineField label="地图位置 X / Y">
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input style={{ ...S.input, width: 56 }} type="number" value={npc.position.x}
                      onChange={e => updateNpc(idx, { position: { ...npc.position, x: Number(e.target.value) } })} />
                    <input style={{ ...S.input, width: 56 }} type="number" value={npc.position.y}
                      onChange={e => updateNpc(idx, { position: { ...npc.position, y: Number(e.target.value) } })} />
                  </div>
                </InlineField>
              </div>

              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <label style={S.toggle}>
                  <input type="checkbox" checked={npc.is_key_npc}
                    onChange={e => updateNpc(idx, { is_key_npc: e.target.checked })} />
                  <span style={{ marginLeft: 6, color: '#aaa', fontSize: 13 }}>关键NPC（死亡影响评分）</span>
                </label>
                <label style={S.toggle}>
                  <input type="checkbox" checked={npc.alive}
                    onChange={e => updateNpc(idx, { alive: e.target.checked })} />
                  <span style={{ marginLeft: 6, color: '#aaa', fontSize: 13 }}>初始存活</span>
                </label>
              </div>

              {npc.is_key_npc && (
                <InlineField label={`关键NPC权重（${npc.key_npc_weight}）`}>
                  <input type="range" min={0.1} max={2} step={0.1} value={npc.key_npc_weight}
                    onChange={e => updateNpc(idx, { key_npc_weight: Number(e.target.value) })}
                    style={{ width: 180 }} />
                </InlineField>
              )}

              {npc.type === 'llm' && (
                <>
                  <InlineField label="系统提示词" hint="定义LLM NPC的人格、秘密、行为边界">
                    <textarea style={{ ...S.input, height: 120, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
                      value={npc.llm_system_prompt || ''}
                      placeholder="你是...（NPC人格设定）"
                      onChange={e => updateNpc(idx, { llm_system_prompt: e.target.value })} />
                  </InlineField>
                  <InlineField label="记忆窗口（轮）" hint="LLM保留最近N轮对话">
                    <input style={{ ...S.input, width: 80 }} type="number"
                      value={npc.llm_memory_window || 10}
                      onChange={e => updateNpc(idx, { llm_memory_window: Number(e.target.value) })} />
                  </InlineField>
                </>
              )}

              {npc.type === 'scripted' && (
                <InlineField label="默认回复（兜底文案）">
                  <input style={S.input}
                    value={npc.npc_responses?.default || ''}
                    placeholder="我不想说话。"
                    onChange={e => updateNpc(idx, { npc_responses: { ...npc.npc_responses, default: e.target.value } })} />
                </InlineField>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Quests Tab ───────────────────────────────────────────────────────────────

function QuestsTab({ quest, onChange }: {
  quest: WorldConfig['quests']['main_quest']
  onChange: (q: WorldConfig['quests']['main_quest']) => void
}) {
  const nodes = Object.values(quest.nodes || {})
  const [expanded, setExpanded] = useState<string | null>(null)

  function addNode() {
    const id = `node_${Date.now()}`
    const newNode: QuestNode = {
      id, name: '新节点', prerequisites: [],
      complete_condition: '', is_critical_path: false,
      is_hidden: false, anti_cheat_lock: false,
    }
    onChange({ ...quest, nodes: { ...quest.nodes, [id]: newNode } })
    setExpanded(id)
  }

  function updateNode(id: string, patch: Partial<QuestNode>) {
    onChange({ ...quest, nodes: { ...quest.nodes, [id]: { ...quest.nodes[id], ...patch } } })
  }

  function removeNode(id: string) {
    const n = { ...quest.nodes }; delete n[id]; onChange({ ...quest, nodes: n })
  }

  const nodeIds = Object.keys(quest.nodes || {})

  return (
    <div style={S.form}>
      <Row label="任务名称">
        <input style={S.input} value={quest.name}
          onChange={e => onChange({ ...quest, name: e.target.value })} />
      </Row>

      <div style={{ marginTop: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ color: '#888', fontSize: 13 }}>任务节点 — AI按此顺序推进剧情</span>
          <button style={S.btnAdd} onClick={addNode}>+ 添加节点</button>
        </div>

        {/* Flow preview */}
        {nodes.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16, padding: '8px 12px', background: '#050d15', borderRadius: 6, border: '1px solid #1a2a3a' }}>
            {nodes.map((n, i) => (
              <div key={n.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, background: n.is_critical_path ? '#0a1a2a' : '#0d1008', color: n.is_critical_path ? '#44aaff' : '#446644', border: `1px solid ${n.is_critical_path ? '#1a3a5a' : '#1a2a1a'}` }}>
                  {n.name}
                </span>
                {i < nodes.length - 1 && <span style={{ color: '#2a3a4a' }}>→</span>}
              </div>
            ))}
          </div>
        )}

        {nodes.map(node => (
          <div key={node.id} style={S.card}>
            <div style={S.cardHeader} onClick={() => setExpanded(expanded === node.id ? null : node.id)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {node.is_critical_path && <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#44aaff', display: 'inline-block' }} />}
                <span style={{ color: '#ddeeff' }}>{node.name}</span>
                <span style={{ color: '#444', fontSize: 12 }}>({node.id})</span>
                {node.is_hidden && <span style={{ ...S.typeBadge, background: '#1a1a0a', color: '#88aa44' }}>隐藏</span>}
                {node.anti_cheat_lock && <span style={{ ...S.typeBadge, background: '#1a0a0a', color: '#cc4444' }}>反作弊锁</span>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={S.btnDanger} onClick={e => { e.stopPropagation(); removeNode(node.id) }}>删除</button>
                <span style={{ color: '#444' }}>{expanded === node.id ? '▲' : '▼'}</span>
              </div>
            </div>

            {expanded === node.id && (
              <div style={{ padding: '12px 16px', borderTop: '1px solid #1a2a3a', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <InlineField label="节点ID">
                    <input style={S.input} value={node.id}
                      onChange={e => updateNode(node.id, { id: e.target.value })} />
                  </InlineField>
                  <InlineField label="节点名称">
                    <input style={S.input} value={node.name}
                      onChange={e => updateNode(node.id, { name: e.target.value })} />
                  </InlineField>
                </div>
                <InlineField label="完成条件" hint="如：npc_zhang.state == 'reveal_location'">
                  <input style={{ ...S.input, fontFamily: 'monospace', fontSize: 12 }}
                    value={node.complete_condition}
                    placeholder="session.turn >= 1"
                    onChange={e => updateNode(node.id, { complete_condition: e.target.value })} />
                </InlineField>
                <InlineField label="前置节点（选多个）">
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {nodeIds.filter(id => id !== node.id).map(id => (
                      <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                        <input type="checkbox"
                          checked={node.prerequisites.includes(id)}
                          onChange={e => {
                            const p = e.target.checked
                              ? [...node.prerequisites, id]
                              : node.prerequisites.filter(x => x !== id)
                            updateNode(node.id, { prerequisites: p })
                          }} />
                        <span style={{ color: '#888', fontSize: 12 }}>{id}</span>
                      </label>
                    ))}
                    {nodeIds.filter(id => id !== node.id).length === 0 &&
                      <span style={{ color: '#444', fontSize: 12 }}>无其他节点</span>}
                  </div>
                </InlineField>
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                  {[
                    ['is_critical_path', '关键路径（计入通关率）'],
                    ['is_hidden', '隐藏节点（探索加分）'],
                    ['anti_cheat_lock', '反作弊锁（防攻略）'],
                  ].map(([key, label]) => (
                    <label key={key} style={S.toggle}>
                      <input type="checkbox" checked={(node as any)[key]}
                        onChange={e => updateNode(node.id, { [key]: e.target.checked })} />
                      <span style={{ marginLeft: 6, color: '#aaa', fontSize: 13 }}>{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Scoring Tab ──────────────────────────────────────────────────────────────

function ScoringTab({ scoring, winConds, failConds, onChange, onWin, onFail }: {
  scoring: WorldConfig['scoring']; winConds: string[]; failConds: string[]
  onChange: (p: any) => void; onWin: (w: string[]) => void; onFail: (f: string[]) => void
}) {
  return (
    <div style={S.form}>
      <div style={{ color: '#555', fontSize: 12, marginBottom: 16, padding: '8px 12px', background: '#050d15', borderRadius: 6 }}>
        评分公式：速度×25% + 质量×30% + NPC存活×20% + 效率×15% + 探索×10%
      </div>

      <Row label="基准通关时间（分钟）" hint="正常速度通关的预期时间，影响速度分">
        <input style={{ ...S.input, width: 100 }} type="number"
          value={Math.round(scoring.baseline_time_ms / 60000)}
          onChange={e => onChange({ baseline_time_ms: Number(e.target.value) * 60000 })} />
      </Row>
      <Row label="基准Token消耗" hint="高效AI的预期消耗，影响效率分">
        <input style={{ ...S.input, width: 100 }} type="number" value={scoring.baseline_tokens}
          onChange={e => onChange({ baseline_tokens: Number(e.target.value) })} />
      </Row>
      <Row label="关键路径节点数" hint="与任务tab中勾选了「关键路径」的节点数保持一致">
        <input style={{ ...S.input, width: 80 }} type="number" value={scoring.critical_nodes_total}
          onChange={e => onChange({ critical_nodes_total: Number(e.target.value) })} />
      </Row>
      <Row label="隐藏事件总数" hint="与任务tab中勾选了「隐藏节点」的数量保持一致">
        <input style={{ ...S.input, width: 80 }} type="number" value={scoring.hidden_events_total}
          onChange={e => onChange({ hidden_events_total: Number(e.target.value) })} />
      </Row>

      <div style={{ marginTop: 24 }}>
        <div style={{ color: '#7fff7f', fontSize: 13, fontWeight: 500, marginBottom: 8 }}>胜利条件</div>
        {winConds.map((c, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <input style={{ ...S.input, flex: 1, fontFamily: 'monospace', fontSize: 12 }} value={c}
              onChange={e => { const w = [...winConds]; w[i] = e.target.value; onWin(w) }} />
            <button style={S.btnDanger} onClick={() => onWin(winConds.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button style={S.btnAdd} onClick={() => onWin([...winConds, 'quest.main_quest.node_end.complete == true'])}>
          + 添加胜利条件
        </button>
      </div>

      <div style={{ marginTop: 20 }}>
        <div style={{ color: '#ff7f7f', fontSize: 13, fontWeight: 500, marginBottom: 8 }}>失败条件</div>
        {failConds.map((c, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
            <input style={{ ...S.input, flex: 1, fontFamily: 'monospace', fontSize: 12 }} value={c}
              onChange={e => { const f = [...failConds]; f[i] = e.target.value; onFail(f) }} />
            <button style={S.btnDanger} onClick={() => onFail(failConds.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <button style={S.btnAdd} onClick={() => onFail([...failConds, 'player.hp <= 0'])}>
          + 添加失败条件
        </button>
      </div>

      <div style={{ marginTop: 20, padding: '10px 14px', background: '#0a1008', borderRadius: 6, border: '1px solid #1a2a1a' }}>
        <div style={{ color: '#446644', fontSize: 12, marginBottom: 6 }}>条件表达式速查</div>
        <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#556655', lineHeight: 1.8 }}>
          {`player.hp <= 0                          // 玩家血量归零\n`}
          {`session.elapsed_ms >= 1800000           // 超过30分钟（毫秒）\n`}
          {`quest.main_quest.node_end.complete == true  // 任务节点完成\n`}
          {`player.inventory CONTAINS 'item_id'     // 背包含有物品\n`}
          {`npc_zhang.alive == false                // NPC死亡`}
        </div>
      </div>
    </div>
  )
}

// ─── JSON Tab ─────────────────────────────────────────────────────────────────

function JsonTab({ value, onChange, error }: { value: string; onChange: (s: string) => void; error: string }) {
  return (
    <div style={S.form}>
      <div style={{ color: '#555', fontSize: 12, marginBottom: 8 }}>
        直接编辑原始JSON — 保存时会覆盖表单数据
      </div>
      {error && <div style={{ color: '#ff4444', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      <textarea
        style={{ ...S.input, width: '100%', height: 'calc(100vh - 240px)', fontFamily: 'monospace', fontSize: 12, resize: 'none' }}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 16, alignItems: 'start', paddingBottom: 14, borderBottom: '1px solid #0d1a26' }}>
      <div>
        <div style={S.label}>{label}</div>
        {hint && <div style={S.hint}>{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  )
}

function InlineField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ color: '#667788', fontSize: 11, marginBottom: 4 }}>{label}{hint && <span style={{ color: '#3a4a5a', marginLeft: 6 }}>{hint}</span>}</div>
      {children}
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  root: { background: '#030912', minHeight: '100vh', color: '#c8d8e8', fontFamily: "'JetBrains Mono', 'Fira Code', monospace" },
  loading: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#446644', fontFamily: 'monospace' },
  header: { display: 'flex', alignItems: 'center', padding: '10px 20px', borderBottom: '1px solid #0d1a26', background: '#040d18', gap: 16 },
  back: { color: '#446688', textDecoration: 'none', fontSize: 13, flexShrink: 0 },
  headerCenter: { flex: 1, display: 'flex', alignItems: 'center', gap: 10 },
  dot: { width: 7, height: 7, borderRadius: '50%', background: '#44cc88', boxShadow: '0 0 6px #44cc88' },
  headerTitle: { color: '#ddeeff', fontWeight: 600, fontSize: 14 },
  headerSub: { color: '#2a4a6a', fontSize: 11 },
  headerActions: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 },
  savedBadge: { color: '#44cc88', fontSize: 12, background: '#0a1a0a', padding: '3px 8px', borderRadius: 4 },
  errBadge: { color: '#cc4444', fontSize: 12 },
  btnSave: { background: '#0a1a0a', border: '1px solid #44cc88', color: '#44cc88', padding: '6px 16px', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' },
  btnPublish: { background: '#1a1000', border: '1px solid #cc8822', color: '#cc8822', padding: '6px 16px', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontFamily: 'inherit' },
  tabs: { display: 'flex', borderBottom: '1px solid #0d1a26', background: '#040d18', paddingLeft: 20 },
  tab: { background: 'none', border: 'none', borderBottom: '2px solid transparent', color: '#446688', padding: '10px 16px', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', transition: 'color 0.15s' },
  tabActive: { color: '#44aaff', borderBottomColor: '#44aaff' },
  content: { padding: '24px 28px', maxWidth: 900 },
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  label: { color: '#7a9aaa', fontSize: 13, fontWeight: 500 },
  hint: { color: '#3a5a6a', fontSize: 11, marginTop: 2, lineHeight: 1.4 },
  input: { background: '#0a1520', border: '1px solid #1a2a3a', color: '#c8d8e8', padding: '6px 10px', borderRadius: 4, fontSize: 13, fontFamily: 'inherit', width: '100%', outline: 'none' },
  select: { background: '#0a1520', border: '1px solid #1a2a3a', color: '#c8d8e8', padding: '6px 10px', borderRadius: 4, fontSize: 13, fontFamily: 'inherit', width: '100%' },
  toggle: { display: 'flex', alignItems: 'center', cursor: 'pointer' },
  card: { border: '1px solid #1a2a3a', borderRadius: 6, overflow: 'hidden', marginBottom: 8 },
  cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#06101a', cursor: 'pointer' },
  typeBadge: { padding: '1px 7px', borderRadius: 3, fontSize: 11, fontWeight: 500 },
  btnAdd: { background: '#0a1a0a', border: '1px solid #2a5a2a', color: '#44aa44', padding: '5px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' },
  btnDanger: { background: '#1a0808', border: '1px solid #4a1a1a', color: '#884444', padding: '3px 8px', borderRadius: 3, cursor: 'pointer', fontSize: 12, fontFamily: 'inherit' },
  charBadge: { display: 'inline-flex', width: 28, height: 28, alignItems: 'center', justifyContent: 'center', background: '#050a10', border: '1px solid #1a2a3a', borderRadius: 3, fontFamily: 'monospace', fontWeight: 'bold', fontSize: 14, flexShrink: 0 },
  emptyHint: { color: '#2a4a5a', fontSize: 13, textAlign: 'center', padding: '32px 0', lineHeight: 2 },
}
