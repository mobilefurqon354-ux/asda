# Claude animation skills

Skills for Claude Code that make animations for reels, with no footage needed. You type `/map-route home to the gym, 2.8 km` and Claude writes the spec, renders the animation on your own computer and checks it against Instagram's safe area.

![The six skills, one frame each](docs/skills.jpg)

| Skill | What it makes | Try it with |
|---|---|---|
| `/zach-d-films` | **A 3D cartoon "what if" explainer.** Cartoon people, props and effects built in three.js, slow-motion impacts, a red force ripple and captions timed to your voiceover. Comes with a finished 29 s example to build from. | `Could ancient armour stop an arrow?` |
| `/stick-figure` | **A stick-figure explainer reel.** A bright cartoon world, stick people with big faces, whip transitions, 1 to 2 word captions, and music and sound effects made in code. Comes with a finished 37 s example. | `Why did pirates wear eye patches?` |
| `/minimalistic-graphics` | **Black-and-white line art.** Hairline steps rise, one white dot hops up them and gets an orbit at the top, with one quiet line of text. | `Every step feels small until you look back` |
| `/map-route` | **A 3D map route.** A white city, a route that draws itself while the camera follows, a pin drop, an ETA that counts down and a destination card. | `Home to the gym, 2.8 km` |
| `/breakdown` | **A 3D exploded view.** A phone comes apart layer by layer, and every part gets a leader line and a label. | `My phone, every part labelled` |
| `/graph` | **A minimal line graph.** A smooth line draws itself, and one big number counts up with its tip. Black on white, or white on black. | `0 to 100K followers in 9 months` |

See them moving: **[novitckii.com/resources/animation-skills](https://novitckii.com/resources/animation-skills/)**

## Install

You need macOS or Linux with **ffmpeg**, **Node.js 18+** and **Python 3.9+**.

```bash
brew install ffmpeg node        # if you don't have them
git clone https://github.com/artemnovitckii/claude-animation-skills.git ~/claude-animation-skills
cd ~/claude-animation-skills && ./install.sh
```

`install.sh` links every skill into `~/.claude/skills/` (so they show up as `/graph`, `/map-route` and so on) and runs the one-time setup. The setup installs three.js and Playwright into `kit/node_modules`, fetches GSAP and warms up HyperFrames.

`/stick-figure` and `/zach-d-films` also need a free voice and word timings. They run on your computer, with no API key, and need about 1 GB of models, downloaded once:

```bash
./install.sh --voice
```

To update later, run `git pull && ./install.sh`.

**It's also packaged as a Claude Code plugin.** Run these inside Claude Code:
```
/plugin marketplace add artemnovitckii/claude-animation-skills
/plugin install animation-skills@claude-animation-skills
```
Plugin skills are namespaced (`/animation-skills:graph`). The git clone above is the route tested end to end.

## Use

Open Claude Code anywhere and ask:

```
/graph 0 to 100K followers in 9 months: 1.2K, 2.1K, 3.4K, 5K, 9K, 24K, 51K, 78K, 100K
/map-route home to the gym, 2.8 km, 9 minutes
/minimalistic-graphics every step feels small until you look back
/breakdown my phone, label it like a joke
/stick-figure why did pirates wear eye patches?
/zach-d-films could ancient armour stop an arrow? (my voiceover is ~/Downloads/vo.m4a)
```

**The four quick ones** (`/graph`, `/minimalistic-graphics`, `/map-route`, `/breakdown`) work from a small JSON spec. Claude writes `name.graph.json`, runs the skill's `build.py`, and you get `name.graph.mp4` (1080x1920, 30 fps) plus `name.graph.sheet.jpg`, a contact sheet with Instagram's safe area marked. The 2D ones render in about 10 seconds, the 3D ones in about 1.5 minutes.

**The two engines** (`/stick-figure`, `/zach-d-films`) are full explainer reels. Claude copies the example project, writes the script with you, makes or takes the voiceover, times every caption to it, writes the shots in code, checks stills, and renders. Plan on a working session, not one command.

## How it's built

```
skills/<name>/SKILL.md          what Claude follows: steps, the spec, taste rules
skills/<name>/build.py          spec.json -> template.html -> HyperFrames -> mp4   (graph, minimalistic-graphics, map-route, breakdown)
skills/<name>/template.html     the animation (GSAP, or three.js for the 3D ones)
skills/stick-figure/engine/     canvas engine, voice + timing tools, make.sh, and the pirate reel as the template
skills/zach-d-films/engine/     three.js engine (people, props, effects, renderer) and the armour short as the example
kit/anim.py                     shared: fill a template, render, snapshots, contact sheet
kit/words.py                    word timings for a voiceover (Parakeet, on your computer)
kit/setup.sh                    one-time setup
```

To add a quick skill, copy a folder like `skills/graph`, change `template.html` (read the spec from `const SPEC = __SPEC__`) and its `DEFAULTS` in `build.py`, then run `./install.sh` again.

## Credits

- [HyperFrames](https://github.com/heygen-com/hyperframes) by HeyGen renders the quick skills.
- [three.js](https://threejs.org) draws the 3D, [GSAP](https://gsap.com) drives the 2D animation and [Playwright](https://playwright.dev) runs the engines' headless Chrome. They are installed at setup, not included here.
- The free voice is [Kokoro](https://github.com/thewh1teagle/kokoro-onnx) and the word timings come from NVIDIA's Parakeet through [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx). The models are downloaded at setup, not included here.
- The fonts are Inter, Inter Tight, Poppins, JetBrains Mono, Montserrat and Lora, all under the SIL Open Font License.
- `/zach-d-films` is named after the style of short it makes. It isn't affiliated with Zack D. Films.

Made by [Artem Novitckii](https://novitckii.com). MIT licensed.
