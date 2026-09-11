# Lumina Live public web library rights audit — 2026

Reviewed 2026-09-10–11 (Asia/Tokyo); completed 2026-09-11. Repository: `C:/Users/masuk/OneDrive/デスクトップ/Codex作業場/vj-live`.

**Decision: approve the visual content of exactly 118 existing open assets for public HTTPS hosting and bundling, subject to the conditions below.** The machine-readable [approved ID array](web-library-approved-ids.json) contains those 118 exact catalog IDs, in existing open-manifest order. It is a rights allowlist for **silent public renditions**, not authorization to upload every current catalog file unchanged. Do not use an `open-*` wildcard or include future acquisitions automatically.

This is a bounded approval-classification audit of existing downloaded media, not a blanket legal guarantee. It covers source redistribution and playable library copies, not merely live performance. The parent task owns encoding, hosting, credit presentation and folder import. No media, scripts, catalog, App, UI, Sites or deployment was changed here.

## Packaging decision

- **94 current files are already silent:** all 92 Mantissa proxies, NASA Solar System, and ESO Milky Way. Their video total is **1,348,167,855 bytes**. ESO still needs visible attribution.
- **24 current files contain an audio track:** NASA SDO 19, NOAA 2, USGS 1, NPS 1 and Hubble 1. Their current total is **1,165,639,923 bytes**. Export/remux video-only before public hosting; do not merely mute playback. This audit does not clear their audio. For USGS/NPS this is a conservative scope choice, not a finding that their sound is copyrighted.
- **ESO and Hubble (2 IDs) need full visible credits, source links, CC BY 4.0 link and change notice.** To make separately playable/downloadable MP4s safe to separate from the app, retain or add the full credit in the video (overlay or end credit), with active source/license links alongside the online player. A hidden credits panel or JSON metadata alone is insufficient for this approval.
- **125 current catalog assets are not approved:** Beeple 85 and Neb Motion 40. Keep these out of public media directories, bundles, thumbnails and caches. Folder import can use the user’s existing local copies; local import does not confer public redistribution rights.

There are 251 downloaded originals: 118 open + 93 Beeple + 40 Neb. Eight Beeple MANIFEST originals were already excluded from the 243-entry catalog for separate content-review reasons. None of the 133 pack originals is approved by this audit.

## Included counts and measured storage

All sizes below are filesystem byte counts at this review, not provider estimates. “Current playable” follows `assets/catalog.json.url` and may point to an original; “Existing proxy” counts only `assets/prepared.json.entries[id].prepared === true`. These columns overlap and must not be added as distinct media. Future silent-web encoding sizes are unknown.

| Provider | Approved IDs | Original bytes | Current playable bytes | Existing proxies | Proxy bytes | Thumbnail bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Mantissa | 92 | 7,210,566,598 | 1,341,214,850 | 92 | 1,341,214,850 | 1,067,637 |
| NOAA Ocean Exploration | 2 | 123,219,086 | 123,219,086 | 0 | 0 | 10,058 |
| USGS | 1 | 1,404,425 | 1,404,425 | 0 | 0 | 8,744 |
| National Park Service | 1 | 277,169,238 | 277,169,238 | 0 | 0 | 6,982 |
| NASA SVS | 20 | 747,194,832 | 717,419,814 | 1 | 3,321,728 | 149,586 |
| ESO | 1 | 51,492,812 | 3,631,277 | 1 | 3,631,277 | 3,613 |
| ESA/Hubble | 1 | 49,749,088 | 49,749,088 | 0 | 0 | 1,771 |
| **Total** | **118** | **8,460,796,079** | **2,513,807,778** | **94** | **1,348,167,855** | **1,248,391** |

Current playable video + its 118 thumbnails totals **2,515,056,169 bytes** (about 2.515 GB decimal). Metadata and any new credit graphics are extra. Existing open originals total about 8.461 GB; they need not all be uploaded alongside the proxies.

## Primary-source decisions

**Mantissa — 92 approved, CC0 1.0.** The [creator’s VJ page](https://mantissa.xyz/vj.html) explicitly dedicates these loops to CC0 and makes credit optional. [CC0](https://creativecommons.org/publicdomain/zero/1.0/) permits copying, modifying and redistributing, including commercially. This covers standalone loops and an app media bundle. Retain the optional credit `Midge “Mantissa” Sinnaeve — mantissa.xyz` and the source URL for provenance. All current Mantissa playables are silent proxies. Original IDs `open-mantissa-113` and `open-mantissa-114` have audio according to the acquisition probe; use their silent proxies, consistent with the scope of this list.

**NASA SVS — 20 approved, public-domain visual content.** [SVS reuse guidance](https://svs.gsfc.nasa.gov/help/) expressly permits reuse and redistribution, except where noted; separately licensed music is excluded while the visuals remain reusable. The [SDO Video Toolkit 14126](https://svs.gsfc.nasa.gov/14126/) supplies the selected 19 solar clips and names NASA’s Goddard Space Flight Center as credit. All 19 selected download URLs match links on the current page (relative links resolved to absolute URLs). [Solar System Animation 20249](https://svs.gsfc.nasa.gov/20249/) supplies the selected 4K MOV and credits the Conceptual Image Lab. No selected visual exception was identified on these pages. Keep the credits below; exclude the 19 SDO audio tracks. [NASA’s general guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/) preserve third-party copyright, person/identity and logo restrictions and prohibit implied endorsement. The government public-domain classification refers to U.S. status; no independent worldwide copyright determination is claimed.

**NOAA — 2 approved, public-domain visuals with source credit.** The [Ocean Exploration FAQ](https://oceanexplorer.noaa.gov/faqs/) permits distribution except for material marked otherwise, asks that the original credit and source URL be carried forward, and distinguishes contributed copyrighted material. [Diving for Details](https://oceanexplorer.noaa.gov/multimedia/video-playlist-extras-diving/) credits NOAA Ocean Exploration; [Jellyfish](https://oceanexplorer.noaa.gov/multimedia/okeanos-explorations-ex2107-gallery-media-dive03-jellyfish/) credits NOAA Ocean Exploration, Windows to the Deep 2021. Neither selected page identifies a third-party visual copyright exception. Publish their silent renditions and preserve credits/metadata.

**USGS — 1 approved, individually marked public domain.** [Lava flow](https://www.usgs.gov/media/videos/lava-flow) carries an asset-specific public-domain usage designation and identifies Hawaiian Volcano Observatory. Preserve `USGS / Hawaiian Volcano Observatory`; the silent rendition is included. This is not an assumption about all USGS-hosted media.

**NPS — 1 approved, individually marked public domain.** The [Summer rainfall asset](https://npgallery.nps.gov/AssetDetail/4e87e5ab-61f0-4c8c-955f-80ae6c4d5b96) identifies full public-domain granting rights and the credit `NPS / Ally O'Rullian`. Its description includes visitors, a shuttle, cars and signs: the classification clears the supplied footage’s copyright, not releases for people or implied promotional endorsements. Include the silent clip as credited scenic footage; do not represent depicted visitors as endorsing Lumina Live.

**ESO — 1 approved, CC BY 4.0 with visible full credit.** [Milky Way revealed](https://www.eso.org/public/videos/uhd_yb_paranal_01/) credits `ESO/B. Tafreshi`, with B. Tafreshi linked to [The World at Night](https://twanight.org/). [ESO’s copyright terms](https://eso.org/public/outreach/copyright/) allow reproduction/adaptation and require clear full credits with active online links. They also distinguish music and logo exceptions. The selected original and current proxy have no audio.

**ESA/Hubble — 1 approved, CC BY 4.0 visuals only.** [Zoom into Pillars of Creation](https://esahubble.org/videos/heic1501f/) gives the full credit `NASA, ESA/Hubble and the Hubble Heritage Team`. [Hubble’s copyright terms](https://esahubble.org/copyright/) allow visual reuse, require credits that stay associated with footage, and exclude music from the blanket license. The current MP4 contains audio: remove it for the approved public rendition. Do not substitute general ESA or HubbleSite terms for this specific ESA/Hubble source.

The [CC BY 4.0 license](https://creativecommons.org/licenses/by/4.0/) permits standalone or bundled redistribution and adaptation, including commercial use, with attribution, a license link, an indication of changes and no added legal/technical restrictions on the licensed material. Label the two clips separately from the app’s code license. Do not apply an app-wide “no redistribution” condition or DRM to them.

## Credits for the public package

| Exact ID or approved group | Credit text | Source / license and transformation notice |
| --- | --- | --- |
| 92 approved Mantissa IDs | Midge “Mantissa” Sinnaeve — mantissa.xyz (optional) | [Creator](https://mantissa.xyz/vj.html), [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/); identify Lumina transcode if desired. |
| 19 approved `open-nasa-14126-…` IDs | NASA's Goddard Space Flight Center | [Source](https://svs.gsfc.nasa.gov/14126/); public-domain visuals; audio removed and any resize/transcode noted. |
| `open-nasa-solar-system-4k` | NASA's Goddard Space Flight Center Conceptual Image Lab | [Source](https://svs.gsfc.nasa.gov/20249/); public-domain visuals; current proxy resized/transcoded. |
| `open-noaa-diving-details` | NOAA Ocean Exploration | [Source](https://oceanexplorer.noaa.gov/multimedia/video-playlist-extras-diving/); public-domain visuals; audio removed. |
| `open-noaa-jellyfish-ex2107` | NOAA Ocean Exploration, Windows to the Deep 2021 | [Source](https://oceanexplorer.noaa.gov/multimedia/okeanos-explorations-ex2107-gallery-media-dive03-jellyfish/); public-domain visuals; audio removed. |
| `open-usgs-lava-flow` | USGS / Hawaiian Volcano Observatory | [Source](https://www.usgs.gov/media/videos/lava-flow); public domain; audio removed. |
| `open-nps-summer-rainfall` | NPS / Ally O'Rullian | [Source](https://npgallery.nps.gov/AssetDetail/4e87e5ab-61f0-4c8c-955f-80ae6c4d5b96); public domain; audio removed. |
| `open-eso-milky-way` | ESO/B. Tafreshi | [Source](https://www.eso.org/public/videos/uhd_yb_paranal_01/), [B. Tafreshi](https://twanight.org/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); “Resized/transcoded by Lumina Live; credit added” if that is what the packager does. |
| `open-hubble-pillars` | NASA, ESA/Hubble and the Hubble Heritage Team | [Source](https://esahubble.org/videos/heic1501f/), [NASA](https://www.nasa.gov/), [ESA/Hubble](https://www.spacetelescope.org/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); “Audio removed; transcoded and credit added by Lumina Live” as applicable. |

Carry the source, license and actual changes into the distributed credit manifest and visible web presentation. If the app later recolors/crops/remixes footage, make the change notice reflect that output. Preserve source credit in separate projection/recording output as well. Credits are source acknowledgments, not claims of sponsorship.

## Excluded packs and limits of the exclusion

| Pack | Downloaded originals | In current catalog | Approved |
| --- | ---: | ---: | ---: |
| beeple-four-color-process | 10 | 10 | 0 |
| beeple-manifest | 66 | 58 | 0 |
| beeple-brainfader | 8 | 8 | 0 |
| neb-abstract-tunnels-2 | 10 | 10 | 0 |
| neb-retro-sunsets-1 | 10 | 10 | 0 |
| neb-abstract-tunnels-1 | 10 | 10 | 0 |
| neb-abstract-geometry-1 | 10 | 10 | 0 |
| beeple-resolume | 9 | 9 | 0 |

**Beeple:** the [current official page](https://www.beeple-crap.com/vjloops) permits commercial and noncommercial creative use but names no CC variant/version; it separately reserves soundtrack rights. The local pack records likewise say source redistribution is not established. No explicit universal redistribution ban was found on the cited page; “not approved” here means insufficient precise licensing evidence for a public stock-like library under the requested CC0/PD/CC BY rule. Do not relabel Beeple as CC0 or infer raw-library rights from permission to make videos.

**Neb Motion:** the [free-pack page](https://nebmotion.co.uk/vj-loops/free/) says Creative Commons without a version and makes credit optional. The [current FAQ](https://nebmotion.co.uk/faq/) additionally names CC BY-SA while also saying credit is optional and forbidding redistribution/resale “as your own.” That qualification is not a blanket ban on all properly credited redistribution; however the contradictory attribution text, unspecified version and mapping to the downloaded packs remain unresolved. BY-SA is also outside this audit’s requested CC0/PD/CC BY approval set. The FAQ’s [precise-license link](https://nebmotion.co.uk/licenses/) returned HTTP 404 on a direct request during this review (web search had an older “Coming Soon” result). Therefore all 40 Neb files remain excluded; no claim is made that the FAQ proves all redistribution unlawful.

No Pexels, Pixabay, Mixkit, Canva-export or VideoZero-export files appear in these downloaded candidate manifests. Their platform licenses and unacquired projects add zero approved IDs. Do not interpret a source’s “free” or “commercial use” label as permission to publish a standalone media library.

## Exact file mapping for packaging

For each approved ID, join by exact `id` to the current catalog; use its `url` with the leading slash removed as a repository-relative file path. `thumbnail` works the same way. Original provenance and source path are in `assets/open-candidates.json` and `assets/prepared.json.entries[id]`. Never construct original filenames from a lowercased ID: the NASA paths preserve case and underscores.

The 92 Mantissa IDs are non-contiguous: 001–076, 087, 090, 092, 095, 096, 097, 100, 104, 106, 113, 114, 117, 118, 119, 122, 124. Their originals are `assets/media/open/mantissa-NNN.mp4`; current silent proxies are `assets/media/prepared/open-mantissa-NNN.mp4`; thumbnails are `assets/media/thumbnails/open-mantissa-NNN.jpg`. Use the JSON array, not a numeric range, as the selection authority.

The remaining 26 IDs and current paths are listed below. **REMOVE AUDIO** refers to a confirmed audio track in the current file; it is a required packaging step for this visual-only approval. “Silent proxy” still carries all credit conditions.

| Exact ID | Current repository-relative playable path | Bytes | Packaging condition |
| --- | --- | ---: | --- |
| `open-noaa-diving-details` | `assets/media/open/noaa-diving-details.mp4` | 71,362,396 | REMOVE AUDIO |
| `open-usgs-lava-flow` | `assets/media/open/usgs-lava-flow.mp4` | 1,404,425 | REMOVE AUDIO |
| `open-nps-summer-rainfall` | `assets/media/open/nps-zion-rainfall.mp4` | 277,169,238 | REMOVE AUDIO |
| `open-nasa-14126-new-trebuchet-mkii` | `assets/media/open/nasa-14126-New_Trebuchet_mkII.mp4` | 33,954,620 | REMOVE AUDIO |
| `open-nasa-14126-helios-second-shot-mkiii` | `assets/media/open/nasa-14126-Helios_Second_Shot_MkIII.mp4` | 136,093,098 | REMOVE AUDIO |
| `open-nasa-14126-magnificent-eruption-mk-ii-overlay` | `assets/media/open/nasa-14126-Magnificent_Eruption_Mk_II-overlay.mp4` | 27,969,345 | REMOVE AUDIO |
| `open-nasa-14126-4033-eclipse-mkii-1` | `assets/media/open/nasa-14126-4033_Eclipse_mkII-1.mp4` | 25,619,388 | REMOVE AUDIO |
| `open-nasa-14126-holiday-lights-blend-move-mkiii` | `assets/media/open/nasa-14126-Holiday_Lights_Blend_Move_MkIII.mp4` | 13,033,439 | REMOVE AUDIO |
| `open-nasa-14126-oct2-eruption-2` | `assets/media/open/nasa-14126-Oct2_Eruption_2.mp4` | 25,688,759 | REMOVE AUDIO |
| `open-nasa-14126-march-7-flare-spin` | `assets/media/open/nasa-14126-March_7_Flare_Spin.mp4` | 22,155,334 | REMOVE AUDIO |
| `open-nasa-14126-july-19-twister` | `assets/media/open/nasa-14126-July_19_Twister.mp4` | 20,960,841 | REMOVE AUDIO |
| `open-nasa-14126-171-304-june-21-pe` | `assets/media/open/nasa-14126-171-304-June_21_PE.mp4` | 24,547,104 | REMOVE AUDIO |
| `open-nasa-14126-oct-cusp-flow-blend-4` | `assets/media/open/nasa-14126-Oct_Cusp_Flow_Blend_4.mp4` | 32,859,390 | REMOVE AUDIO |
| `open-nasa-14126-canyon-of-fire-new-slow` | `assets/media/open/nasa-14126-Canyon_of_Fire_New-Slow.mp4` | 19,788,297 | REMOVE AUDIO |
| `open-nasa-14126-wispy-pull-out-mkvi-hso` | `assets/media/open/nasa-14126-Wispy_pull_out_mkVI_HSO.mp4` | 35,693,969 | REMOVE AUDIO |
| `open-nasa-14126-umbrella-cu-new` | `assets/media/open/nasa-14126-Umbrella-CU_NEW.mp4` | 25,346,384 | REMOVE AUDIO |
| `open-nasa-14126-171-131-blue-blend-flux-rope-sharpened` | `assets/media/open/nasa-14126-171-131_Blue_Blend_flux_rope_sharpened.mp4` | 25,749,067 | REMOVE AUDIO |
| `open-nasa-14126-october-flares-171-screen-c-sharp-and-dark` | `assets/media/open/nasa-14126-October_flares_171-Screen_C-sharp_and_dark.mp4` | 26,188,007 | REMOVE AUDIO |
| `open-nasa-14126-giant-sunspot-track-hso-mkii` | `assets/media/open/nasa-14126-Giant_Sunspot_track_HSO_mkII.mp4` | 31,346,402 | REMOVE AUDIO |
| `open-nasa-14126-4038-solar-ballet-cu-mk-ii` | `assets/media/open/nasa-14126-4038_Solar_Ballet_CU_mk_II.mp4` | 48,689,218 | REMOVE AUDIO |
| `open-nasa-14126-helios-first-shot-mkv` | `assets/media/open/nasa-14126-Helios_First_Shot_mkV.mp4` | 113,145,607 | REMOVE AUDIO |
| `open-nasa-14126-eclipse-masked` | `assets/media/open/nasa-14126-Eclipse_Masked.mp4` | 25,269,817 | REMOVE AUDIO |
| `open-nasa-solar-system-4k` | `assets/media/prepared/open-nasa-solar-system-4k.mp4` | 3,321,728 | Silent proxy |
| `open-eso-milky-way` | `assets/media/prepared/open-eso-milky-way.mp4` | 3,631,277 | Silent proxy; visible CC BY credit |
| `open-hubble-pillars` | `assets/media/open/hubble-pillars-1080.mp4` | 49,749,088 | REMOVE AUDIO; visible CC BY credit |
| `open-noaa-jellyfish-ex2107` | `assets/media/open/noaa-jellyfish-ex2107-hd.mp4` | 51,856,690 | REMOVE AUDIO |

For strict direct hosting of existing bytes with no audio processing, limit selection to the 94 silent proxies above (and satisfy ESO attribution). The 118-ID array is intentionally broader because the parent is implementing silent encoding. Barely hiding a download button, lowering resolution, proxying through HTTPS, embedding in HTML/base64 or bundling in an app does not remove redistribution obligations.

## Evidence and verification boundary

Read the existing open/pack candidate rights objects, `assets/README.md`, `docs/material-sources.md`, `research/report-source.md`, and all 13 unique open source-rights HTML snapshots (captured 2026-09-08–09). Rechecked the linked primary license and selected asset pages via web on this review; the NASA 14126 direct HTML was additionally checked for all 19 resolved download links. The new Neb FAQ qualification above supersedes the older “CC variant unspecified” summary for this audit, while retaining the exclusion. No new source snapshots were saved.

Checked existence and sizes of the 118 originals, 118 current playable targets and 118 thumbnails. Read only MP4/MOV box headers of the 118 current playables: all have a video track, 94 have no audio track, 24 contain audio. Current playable sizes match the catalog. This was not a media decode or full-file hash pass, soundtrack listening test, or full visual-content review; existing `research/library-audit.json` remains the prior technical audit. No whole-library rehash, transcode, media download, UI test or deployment was performed.

Input JSON fingerprints (small metadata files only; these bind this decision to the inspected inventory):

- `assets/catalog.json`: SHA-256 `bff38cf01da8b9c7536be6c30268325aca205842b68b1061a0fecdeee7555e98`
- `assets/open-candidates.json`: SHA-256 `1600e68b43c3793733dc5e33bbda3583f94db88129ad578b6e5550832e60d2be`
- `assets/pack-candidates.json`: SHA-256 `e382d188bc465174f3fd1969a412fb7512cc9e9597f220242809391febe66bbf`
- `assets/prepared.json`: SHA-256 `028a2f9b6ec68039f5ca2a5885556a0a38149bb0b6d12095a9ed07908218e42f`

Reassess an ID if its source/provenance or included tracks change. Public-domain status does not clear unrelated trademarks, personality rights or false endorsement. Those bounded exceptions do not change the 118 visual-content approvals above.
