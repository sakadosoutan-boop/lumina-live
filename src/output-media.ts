import type {Asset} from './types';

/** file:// windows have opaque origins. Give the output its own blob URLs. */
export class OutputMediaBridge {
  private outgoing = new Map<string, Promise<Blob>>();
  private incoming = new Map<string, {source:string;url:string}>();
  async package(assets:Asset[]) {
    const blobs:Record<string,Blob>={};
    await Promise.all(assets.filter(a=>a.url?.startsWith('blob:')).map(async a=>{
      const source=a.url!;
      let blob=this.outgoing.get(source);
      if(!blob){blob=fetch(source).then(r=>{if(!r.ok)throw Error('Media unavailable');return r.blob();});this.outgoing.set(source,blob);}
      try{blobs[a.id]=await blob;}catch{this.outgoing.delete(source);}
    }));
    const sources=new Set(assets.map(a=>a.url));for(const key of this.outgoing.keys())if(!sources.has(key))this.outgoing.delete(key);
    return {type:'assets',assets,blobs};
  }
  restore(assets:Asset[],blobs?:Record<string,Blob>):Asset[]{
    const ids=new Set(assets.map(a=>a.id));
    for(const [id,value] of this.incoming)if(!ids.has(id)){URL.revokeObjectURL(value.url);this.incoming.delete(id);}
    return assets.map(a=>{
      if(!blobs?.[a.id]||!a.url)return a;
      let current=this.incoming.get(a.id);
      if(!current||current.source!==a.url){if(current)URL.revokeObjectURL(current.url);current={source:a.url,url:URL.createObjectURL(blobs[a.id])};this.incoming.set(a.id,current);}
      return {...a,url:current.url};
    });
  }
  dispose(){for(const value of this.incoming.values())URL.revokeObjectURL(value.url);this.incoming.clear();this.outgoing.clear();}
}
