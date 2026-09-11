# Halloween and browser library — 2026-09-11

125 silent online videos are included: 118 existing open-license/public-domain visual sources, five newly downloaded CC0/USGS sources, and two original generated-background camera loops. Together with the 96 procedural visuals, the website offers 221 choices. The local curated catalog now contains 250 videos.

The five new sources are Moon 360 animation (Wikideas1), Drone video of foggy Vetla village (Sillerkiil), Misty river 47 seconds and Misty river (Digitura), and Bats at Wind Turbines (USGS). Their exact source pages, download URLs, licenses and acquisition evidence are in [the candidate report](halloween-candidates.json) and the local acquisition journal. All five downloads succeeded; source bytes 141,239,377; silent prepared videos 30,112,758 bytes; total retained stock directory 171,381,934 bytes. Each original and prepared video was fully decoded. These are atmosphere/reference clips, not all seamless loops. The USGS thermal camera recording contains scientific introductory material and is low resolution; use selectively.

The two original 12-second loops depict a pumpkin gate and a moonlit gothic castle. They animate generated still images using gentle sinusoidal camera movement; the subjects themselves are not AI-generated moving footage. Their master PNGs and MP4s are retained locally in `assets/media/halloween/originals`. Public versions are in `docs/assets/library`. [Render evidence](halloween-originals-build.json).

All online videos total 294,624,702 bytes before thumbnails and metadata. H.264/yuv420p, up to 1280×720 at 30fps, without audio. Existing full-quality sources remain local. ESO and ESA/Hubble videos include visible source and CC BY 4.0 credit overlays. Source/credit links are available from the application. [Exact published files and hashes](web-library-build.json), [rights assessment](web-library-rights-2026.md).

The website supports bounded sequential media caching, cancellation/resume and local folder connection without copying the full library into IndexedDB. Folder catalog matching retains names, tags and licenses and excludes unregistered originals. Cached media belongs to its browser/site; a downloaded standalone HTML must connect its own media folder. A cached open page can continue playing after loss of network, but offline reload of the HTTPS application is not implemented.

Validation: full decode of all newly encoded public videos; automated folder/path/duplicate/size/caching tests plus existing suite; browser online playback, cache persistence after reload and folder catalog connection. Physical Surface/Chromebook/HDMI performance is not verified here.

## Generation provenance

Tool: built-in OpenAI image generation, new-image mode, no reference images. The following are the exact generation prompts; the PNGs were copied to the workspace before video rendering.

**Pumpkin gate** — `halloween-pumpkin-gate.png`

> Use case: stylized-concept. Create one finished 16:9 wide landscape background image for a Halloween live band VJ projection, high quality cinematic 3D fantasy render, not a poster or UI. An eerie old gothic stone arch stands in a misty midnight forest with twisted bare trees; several beautifully carved glowing orange jack-o-lantern pumpkins at the lower left and right edges; subtle violet rim light, amber embers, distant pale full moon in upper center. Deep black-to-indigo negative space through center and lower center must remain uncluttered and dark for Japanese lyric projection. Dramatic rich luminous orange and purple with realistic pumpkin rind and smoky depth, sophisticated theatrical atmosphere rather than childish cartoon. Balanced composition with all key subjects safely inside edges for a small camera zoom. No text, no letters, no logo, no watermark, no people, no copyrighted characters, no gore. This image will be animated with a very slow looping camera move as a reusable VJ background.

**Moonlit castle** — `halloween-moon-castle.png`

> Use case: stylized-concept. One finished 16:9 landscape cinematic Halloween VJ background, no text. A vast luminous pale full moon surrounded by dramatic indigo and teal night clouds; silhouettes of small bats sweeping in an elegant arc across upper edges; low silhouettes of twisted trees and distant gothic spires along the horizon. Rich violet to midnight blue atmosphere, delicate silver moonlight, deep layered drifting mist. Lower central half remains mostly dark low-detail negative space for projected Japanese lyrics. High quality detailed theatrical matte painting / cinematic 3D render, sophisticated spooky mood, no childish cartoon. Wide frame, no captions, no borders, no logos, no watermark, no people, no gore. Safely inset subjects allow slow looping camera motion. This is a reusable live band projection backdrop.
