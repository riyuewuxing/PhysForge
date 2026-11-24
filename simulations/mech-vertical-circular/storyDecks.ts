import { CLASSROOM_GRAVITY } from '@physforge/physics-core';
import type { StoryDeck } from '@physforge/sim-sdk';

const R = 1.4;
const criticalSpeed = Math.sqrt(5 * CLASSROOM_GRAVITY * R);
const inner = { trackMode: 'inner-loop', mass: 1, radius: R, startAngleDeg: 0.5 } as const;

export const verticalCircularStoryDecks: readonly StoryDeck[] = [{
  id: 'm06-loop-threshold', modelId: 'mech-vertical-circular', title: '竖直内圆轨道：最高点约束临界',
  beats: [
    { id: 'm06-subcritical', title: '低于临界初速', caption: '初速不足，法向约束力在最高点之前降为零。',
      speakerNotes: '最高点由重力和法向约束力提供向心力。机械能守恒给出临界底部速度 √(5gR)。本镜使用 0.96 倍临界速度；真实引擎检测法向力过零并切换自由抛体。',
      paramPatch: { ...inner, vLaunch: 0.96 * criticalSpeed }, paramTweenMs: 0, simAction: 'reset-play',
      autoFreeze: { observableKey: 'normalForceN', operator: '<=', threshold: 0, badgeText: 'N=0：约束失效' },
      camera: { view2D: { centerX: 0, centerY: 0, zoom: 1 }, durationMs: 500 },
      layerOverrides: { showFbd: true, highlightFormulaId: 'critical-speed' } },
    { id: 'm06-critical', title: '临界初速', caption: '临界时最高点 N=0，速率为 √(gR)。',
      speakerNotes: '初速设为 √(5gR)。最高点机械能差是 2mgR，且 N=0 时 mg=mv²/R。为了课堂画面稳定，当法向力降至 0.05 N 即近临界定格；这是显示阈值，不是替代引擎的精确事件定位。',
      paramPatch: { ...inner, vLaunch: criticalSpeed }, paramTweenMs: 0, simAction: 'reset-play',
      autoFreeze: { observableKey: 'normalForceN', operator: '<=', threshold: 0.05, badgeText: 'N ≤ 0.05 N：近最高点临界' }, layerOverrides: { showFbd: true, highlightFormulaId: 'critical-speed' } },
    { id: 'm06-supercritical', title: '高于临界初速', caption: '初速略高于临界值，最高点仍有正的约束力。',
      speakerNotes: '改为 1.04 倍临界速度。比较最高点的法向反力与上一镜，说明单边约束不能提供负法向力；如果改为双边轻杆，约束条件不同。',
      paramPatch: { ...inner, vLaunch: 1.04 * criticalSpeed }, paramTweenMs: 0, simAction: 'reset-play', layerOverrides: { showFbd: true, highlightFormulaId: 'critical-speed' } }
  ]
}];
