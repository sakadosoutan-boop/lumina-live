import {describe,it,expect} from 'vitest';
import {beatAt,nextBeatTime,timelineRate,outputUrl} from '../src/live-clock';
import {Transport} from '../src/sync';
describe('live and audio synchronization',()=>{
 it('accelerates a rehearsed timeline after a live tempo change without jumping',()=>{
  const t=new Transport();t.play(0);const pos=t.getTime(10000);
  const old={time:0,beat:0,bpm:120,rate:1};
  const rate=timelineRate({bpm:150,timelineBpm:120},'live');
  const anchor={time:pos,beat:beatAt(pos,old),bpm:150,rate};t.setRate(rate,10000);
  expect(t.getTime(10000)).toBe(10);expect(t.getTime(14000)).toBe(15);
  expect(beatAt(t.getTime(14000),anchor)).toBe(30);
  expect(nextBeatTime(15,4,anchor)).toBe(16);
 });
 it('keeps backing audio at its original timeline speed',()=>{
  expect(timelineRate({bpm:160,timelineBpm:80},'audio')).toBe(1);
 });
 it('quantizes to the next beat after a nonzero tempo anchor',()=>{
  const a={time:10,beat:21,bpm:90,rate:.75};
  expect(nextBeatTime(10,4,a)).toBe(11.5);
  expect(nextBeatTime(11.5,4,a)).toBe(13.5);
  expect(nextBeatTime(10,0,a)).toBe(10);
 });
 it('opens the same standalone file with an output query',()=>{
  expect(outputUrl('file:///C:/Live%20show/Lumina.html')).toBe('file:///C:/Live%20show/Lumina.html?output=1');
  expect(outputUrl('http://127.0.0.1:4173/?a=2#cue')).toBe('http://127.0.0.1:4173/?a=2&output=1');
 });
});
