import React from 'react';
import { StoryRunner, type StoryDeck, type StoryRunnerCallbacks } from '@physforge/sim-sdk';

export function createStoryRunner(deck: StoryDeck, callbacks: StoryRunnerCallbacks): StoryRunner {
  return new StoryRunner(deck, callbacks);
}

interface StoryStageHudProps {
  deck?: StoryDeck;
  index: number;
  blackout: boolean;
  freezeBadge: string | null;
  onPrev: () => void;
  onNext: () => void;
  onGoTo: (index: number) => void;
  onUnblackout: () => void;
}

export const StoryStageHud: React.FC<StoryStageHudProps> = ({ deck, index, blackout, freezeBadge, onPrev, onNext, onGoTo, onUnblackout }) => {
  const beat = deck?.beats[index];
  return <>
    {deck && <div className="pf-story-caption" data-testid="story-hud">
      {beat ? <>
        <div className="pf-story-caption-text" data-testid="story-caption">{beat.caption}</div>
        <div className="pf-story-navigation">
          <button type="button" aria-label="上一分镜" data-testid="btn-story-prev" disabled={index <= 0} onClick={onPrev}>‹</button>
          {deck.beats.map((item, i) => <button key={item.id} type="button" aria-label={`第 ${i+1} 镜：${item.title}`}
            aria-current={i === index ? 'step' : undefined} className={`pf-story-dot ${i === index ? 'active' : ''}`} onClick={() => onGoTo(i)} />)}
          <span data-testid="story-progress">{index + 1}/{deck.beats.length}</span>
          <button type="button" aria-label="下一分镜" data-testid="btn-story-next" disabled={index >= deck.beats.length - 1} onClick={onNext}>›</button>
        </div>
      </> : <span>正在加载分镜…</span>}
      {freezeBadge && <div className="pf-story-freeze" data-testid="story-freeze-badge" role="status">{freezeBadge}</div>}
    </div>}
    {blackout && <div className="pf-story-blackout" data-testid="story-blackout">
      <button type="button" aria-label="解除黑屏" onClick={onUnblackout}>解除黑屏（B / .）</button>
    </div>}
  </>;
};
