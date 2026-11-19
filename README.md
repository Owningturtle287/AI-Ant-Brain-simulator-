# Fire Ant Lab

AI Ant Brain Simulator · Phase 1, body and locomotion

A mobile-first 3D simulator of a red imported fire ant worker (*Solenopsis invicta*). The 3.5 mm model has an articulated head, mandibles, six legs, ten segments per antenna, two waist segments, and a tapering, segmented gaster. The head, mesosoma, waist, mouthparts, and limbs use custom-contoured surfaces based on worker photographs and measured anatomy. The walking controller keeps stance feet and their angles fixed in world coordinates. It predicts the trajectory during each swing, shortening the steps on the inside of a curve, and adjusts toe lift to terrain. The head leads a turn while the waist and abdomen follow with a delay. The gait is a procedural tripod model informed by comparative ant research. The primary renderer uses WebGL 2. A compatibility view projects the same rig and motion onto a 2D canvas when WebGL is unavailable. Joint limits, compliance, and kinematics are approximations.

The head turns side to side, tilts up and down, and rolls at the neck. The petiole, postpetiole, and gaster share the bend through the waist. In a tight turn the head can rotate about 38° from the trunk, with a comparable total side bend at the abdomen. These angles are animation estimates informed by comparative ant anatomy. In **Specimen**, use **Extend sting** to reveal the curved tip and **Side** to inspect the segmented abdomen.

## Run locally

Requires Node.js 22.12+ or 24.

```sh
npm ci
npm run dev
npm test
npm run build
```

For a local offline-install test, run `npm run preview` after building. To run the browser smoke checks, install the test browser with `npx playwright install chromium` and run `npm run test:browser`.

## Phone installation

GitHub Pages can deploy the `Deploy Fire Ant Lab` workflow after the repository's **Settings → Pages → Source** is set to **GitHub Actions**. The resulting Actions run exposes the live site link in its deployment and run summary.

Open the deployment link. On iOS, use **Safari → Share → Add to Home Screen** and turn on **Open as Web App** where available. On Android, use **Chrome → Install app** or **Add to Home screen**. The production app caches its assets for offline use after the first successful load.

## Research

- [AntWeb fire ant worker specimen views](https://www.antweb.org/images.do?caste=worker&genus=solenopsis&project=allantwebants&rank=species&species=invicta&subfamily=myrmicinae)
- [Worker proportions and body-size scaling](https://doi.org/10.1093/jis/3.1.2)
- [Worker morphology, UF/IFAS](https://ask.ifas.ufl.edu/publication/in352)
- [Fire ant motion and stability in tunnels](https://doi.org/10.1073/pnas.1302428110)
- [Comparative tripod stepping patterns in ants](https://pubmed.ncbi.nlm.nih.gov/9317406/)
- [Comparative ant neck and thorax anatomy](https://doi.org/10.1186/s12983-020-00375-9)
- [Ant head movements during walking and scanning](https://pmc.ncbi.nlm.nih.gov/articles/PMC3886322/)
- [Comparative ant abdominal articulation and musculature](https://doi.org/10.1002/jmor.21471)

The planned neural phase uses 250,000 as a **modeling target**. The worker brain study maps anatomical regions and select cell groups. The proposed live brain view will show the model's neuron and connection activity alongside the moving worker. [Worker neuroanatomy study](https://doi.org/10.1371/journal.pone.0083966)
