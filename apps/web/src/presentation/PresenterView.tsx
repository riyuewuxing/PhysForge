import React, { useEffect, useRef, useState } from 'react';
import { PresenterSyncBridge, type PresenterCommand, type StageSnapshotPayload } from './presenterSync.js';

interface Props { sessionId: string }

export const PresenterView: React.FC<Props> = ({ sessionId }) => {
  const [snapshot, setSnapshot] = useState<StageSnapshotPayload | null>(null);
  const [connection, setConnection] = useState('正在等待主屏连接…');
  const [startedAt] = useState(() => performance.now());
  const [elapsed, setElapsed] = useState(0);
  const bridgeRef = useRef<PresenterSyncBridge | null>(null);
  const lastSnapshotAt = useRef(-Infinity);
  const laserAt = useRef(-Infinity);
  const send = (command: PresenterCommand) => bridgeRef.current?.sendCommand(command);

  useEffect(() => {
    if (!sessionId) { setConnection('缺少演说会话 ID，请从主屏打开副屏。'); return; }
    let bridge: PresenterSyncBridge;
    try {
      bridge = new PresenterSyncBridge(sessionId, 'presenter', (envelope) => {
        if (envelope.sender !== 'stage') return;
        lastSnapshotAt.current = performance.now();
        setSnapshot(envelope.msg.payload);
        setConnection('主屏已连接');
      });
    } catch {
      setConnection('当前浏览器无法打开双屏通信通道。');
      return;
    }
    bridgeRef.current = bridge;
    if (!bridge.available) setConnection('当前浏览器不支持 BroadcastChannel。');
    bridge.sendCommand({ type: 'CMD_REQUEST_SYNC' });
    const timer = window.setInterval(() => {
      const now = performance.now();
      setElapsed(Math.floor((now - startedAt) / 1000));
      if (now - lastSnapshotAt.current > 1500 && bridge.available) {
        setConnection('等待主屏同步…');
        bridge.sendCommand({ type: 'CMD_REQUEST_SYNC' });
      }
    }, 500);
    return () => {
      window.clearInterval(timer);
      bridge.sendCommand({ type: 'CMD_LASER_POINTER', active: false, normX: 0, normY: 0 });
      bridge.close();
      bridgeRef.current = null;
    };
  }, [sessionId, startedAt]);

  const enabled = snapshot !== null && connection === '主屏已连接' && snapshot.appMode !== 'studio';
  const pointer = (event: React.PointerEvent<HTMLDivElement>, active: boolean, force = false) => {
    const now = performance.now();
    if (!force && now - laserAt.current < 1000 / 15) return;
    laserAt.current = now;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    send({ type: 'CMD_LASER_POINTER', active,
      normX: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      normY: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) });
  };
  const control = 'rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 font-semibold disabled:opacity-40';
  const mins = Math.floor(elapsed / 60);
  const secs = String(elapsed % 60).padStart(2, '0');

  return <main data-testid="presenter-view" className="h-screen overflow-auto bg-slate-950 p-5 text-slate-100">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 pb-4">
      <div><h1 className="text-2xl font-bold">PhysForge · 教师副屏</h1>
        <div data-testid="presenter-connection" role="status" className="mt-1 text-sm text-sky-300">{connection}</div></div>
      <div className="text-2xl font-mono" title="本副屏开启后的计时">{mins}:{secs}</div>
    </header>
    {!snapshot ? <p className="mt-6 text-slate-400">请保持同一浏览器配置文件中的主屏页面打开。</p> :
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl bg-slate-900 p-5">
          <h2 className="text-xl font-semibold">{snapshot.modelTitle}</h2>
          <div className="mt-2 text-sm text-slate-400">主屏：{snapshot.appMode} · t = {snapshot.simTime.toFixed(2)} s · {snapshot.isPlaying ? '运行' : '暂停'}</div>
          <div data-testid="presenter-beat" className="mt-4 text-lg font-bold text-sky-300">{snapshot.beatIndex + 1}/{snapshot.totalBeats} {snapshot.currentCaption}</div>
          <div data-testid="presenter-notes" className="mt-4 whitespace-pre-wrap text-2xl leading-relaxed">{snapshot.speakerNotes || '自由演说模式，无私密讲稿。'}</div>
          <div className="mt-5 border-t border-slate-700 pt-3 text-slate-400">下一镜：{snapshot.nextBeatTitle ?? '—'}</div>
          {snapshot.freezeBadge && <div className="mt-3 text-amber-300">{snapshot.freezeBadge}</div>}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button className={control} data-testid="presenter-prev" disabled={!enabled || snapshot.appMode !== 'story' || snapshot.beatIndex <= 0} onClick={() => send({ type: 'CMD_PREV_BEAT' })}>上一镜</button>
            <button className={control} data-testid="presenter-next" disabled={!enabled || snapshot.appMode !== 'story' || snapshot.beatIndex >= snapshot.totalBeats - 1} onClick={() => send({ type: 'CMD_NEXT_BEAT' })}>下一镜</button>
            <button className={control} data-testid="presenter-play" disabled={!enabled} onClick={() => send({ type: 'CMD_TOGGLE_PLAY' })}>{snapshot.isPlaying ? '暂停' : '播放'}</button>
            <button className={control} disabled={!enabled} onClick={() => send({ type: 'CMD_RESET_SIM' })}>复位</button>
            <button className={control} data-testid="presenter-blackout" disabled={!enabled} onClick={() => send({ type: 'CMD_TOGGLE_BLACKOUT' })}>{snapshot.isBlackout ? '解除黑屏' : '黑屏'}</button>
            <button className={control} disabled={!enabled || !snapshot.canMorph} onClick={() => send({ type: 'CMD_TOGGLE_MORPH_2D' })}>3D / 2D 切镜</button>
          </div>
        </section>
        <section className="rounded-2xl bg-slate-900 p-5">
          <h2 className="mb-3 text-lg font-semibold">主屏参数微调</h2>
          <div className="max-h-[46vh] space-y-3 overflow-y-auto">
            {snapshot.paramSchema.map((field) => {
              const value = snapshot.params[field.key] ?? field.defaultValue;
              const change = (next: string | number | boolean) => send({ type: 'CMD_SET_PARAM', paramKey: field.key, value: next });
              return <label key={field.key} className="block text-sm">
                <span className="flex justify-between gap-2"><span>{field.label}</span><span>{String(value)} {field.kind === 'number' ? field.unit : ''}</span></span>
                {field.kind === 'number' ?
                  <input className="mt-1 w-full" type="range" min={field.min} max={field.max} step={field.step}
                    disabled={!enabled} value={typeof value === 'number' ? value : field.defaultValue} onChange={(event) => change(Number(event.target.value))} />
                : field.kind === 'boolean' ?
                  <input type="checkbox" disabled={!enabled} checked={value === true} onChange={(event) => change(event.target.checked)} />
                : <select className="mt-1 w-full rounded bg-slate-800 p-2" disabled={!enabled} value={String(value)} onChange={(event) => change(event.target.value)}>
                  {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>}
              </label>;
            })}
          </div>
          <h2 className="mb-2 mt-5 text-lg font-semibold">激光笔触控区</h2>
          <div data-testid="presenter-laser-pad" className="grid aspect-video touch-none place-items-center rounded-xl border border-slate-600 bg-slate-950 text-sm text-slate-400"
            onPointerDown={(event) => { if (!enabled) return; event.currentTarget.setPointerCapture(event.pointerId); pointer(event, true, true); }}
            onPointerMove={(event) => { if (enabled && event.currentTarget.hasPointerCapture(event.pointerId)) pointer(event, true); }}
            onPointerUp={(event) => pointer(event, false, true)}
            onPointerCancel={(event) => pointer(event, false, true)}
            onLostPointerCapture={(event) => pointer(event, false, true)}>
            按住移动：主屏显示激光红点
          </div>
        </section>
      </div>}
  </main>;
};

export default PresenterView;
