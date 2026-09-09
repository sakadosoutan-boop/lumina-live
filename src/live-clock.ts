import type {Song} from './types';

export type SyncMode = 'live'|'audio';
export function timelineRate(song:Pick<Song,'bpm'|'timelineBpm'>, mode:SyncMode):number {
  return mode==='audio' ? 1 : song.bpm/(song.timelineBpm??song.bpm);
}
export interface BeatAnchor {time:number;beat:number;bpm:number;rate:number}
export function beatAt(time:number, anchor:BeatAnchor):number {
  return anchor.beat+(time-anchor.time)*anchor.bpm/(60*anchor.rate);
}
export function nextBeatTime(time:number, quantum:number, anchor:BeatAnchor):number {
  if(quantum<=0)return time;
  const beat=beatAt(time,anchor);
  const next=(Math.floor((beat+1e-7)/quantum)+1)*quantum;
  return time+(next-beat)*60*anchor.rate/anchor.bpm;
}
export function outputUrl(href:string):string {
  const url=new URL(href);url.searchParams.set('output','1');url.hash='';return url.href;
}
