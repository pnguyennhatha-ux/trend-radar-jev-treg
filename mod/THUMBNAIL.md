# Thumbnail brief: the guide Claude follows

The person pressed 🖼 Thumbnail on an idea. The message that started this names the idea folder. The brief is worked out **here in chat**; the panel only shows the pictures.

**1. Look first, with the Read tool:**
- `idea.md` in the folder: the title, angle and proof.
- `inspo/*.jpg`: the competitor thumbnails that worked. These are the point. Note what each does: face size and place, expression, how many words, where the text sits, the one object, the colours, the arrow or circle if any.
- `references/` in the data folder: the person's own photos. Note their look, their clothes, and which photo's expression fits best.
- `refs/` in the idea folder: extra images the person added, if any. Say in the brief how each is used.

**2. Write the brief and show it in chat.** Under 220 words, plain words, concrete and visual. Save the same text to `brief.md` in the folder (the mod reads it from there). Use these headings:

```
# Thumbnail brief: <idea title>

## Layout
Where the person, the text and the object sit. Left / right / centre, how big. Copy what the best winner does, in your own layout.

## The person
Pose and expression, close to one of their photos (name it). Clothes as in the photo.

## Text
The exact words, at most 4, all caps, in quotes. Where they sit, colour, outline.

## Object or visual
The one thing that shows the idea (a laptop screen, a logo tile, a phone). If a refs/ image should be used, say which and how.

## Background and colours
Two or three colours, the mood, the light.

## Borrowed from the winners
One line per inspo picture: what is taken from it.

## Don'ts
Things the model must not do (no other text, no logos drawn from memory, nothing covering the face).
```

Do not number images or write "Image 1" anywhere: the mod adds that part itself (the person's photos first, then refs/, then inspo/).

**3. End with one line:** "Say **generate**, or tell me what to change." Keep the chat short: the brief, then that line.

**4. Changes.** When they ask for a change, edit `brief.md`, show only the changed section in chat, and ask again. If they drop a file into `refs/`, look at it and work it into the brief.

**5. "Generate".** Call the `mcp__trend-radar__thumbnail` tool with the folder name. It draws one picture through treg (about a cent) and shows it in the panel. Tell them in one line where it is and that 🎨 Again in the panel makes another from the same brief. "Another one" or "again" in chat: call the tool again.

**6. "Change the thumbnail for …"** typed from the panel's ✍️ Change button: read `brief.md`, apply what they ask, show the changed section, and ask whether to generate.
