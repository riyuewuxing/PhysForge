import {describe,it,expect} from 'vitest';
import {placeInductionLabels,inductionSegmentBox} from './labelLayout.js';

describe('E04 physical line-aware labels',()=>{
  const safe={left:0,right:300,top:0,bottom:200},rail=inductionSegmentBox(20,80,280,80,7),rod=inductionSegmentBox(140,60,150,140,3);
  const label={id:'force',x:145,y:80,text:'F = 4 N',color:'red'};
  const measure=()=>50;
  it('moves a label off both rail and rod, retaining its text',()=>{
    const [p]=placeInductionLabels([label],[rail,rod],safe,measure);
    expect(p!.text).toBe(label.text);
    for(const q of [rail,rod])expect(p!.box.right<=q.left||p!.box.left>=q.right||p!.box.bottom<=q.top||p!.box.top>=q.bottom).toBe(true);
  });
  it('preserves an unoccupied anchor and separates two labels',()=>{
    const a={...label,x:70,y:30},b={...a,id:'second'};
    const [p,q]=placeInductionLabels([a,b],[],safe,measure);
    expect([p!.x,p!.y]).toEqual([a.x,a.y]);
    expect(p!.box.right<=q!.box.left||p!.box.left>=q!.box.right||p!.box.bottom<=q!.box.top||p!.box.top>=q!.box.bottom).toBe(true);
  });
});
