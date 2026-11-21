import sharp from 'sharp';
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
const source = 'resources/PocketMinGW_iOS_1024.png';
await mkdir('public/brand', { recursive: true });
await sharp(source).resize(128).png().toFile('public/brand/icon.png');
await copyFile(source, 'ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
const res = 'android/app/src/main/res';
for (const [density, scale] of Object.entries({mdpi:1, hdpi:1.5, xhdpi:2, xxhdpi:3, xxxhdpi:4})) {
  const folder = `${res}/mipmap-${density}`;
  for (const name of ['ic_launcher', 'ic_launcher_round']) await sharp(source).resize(Math.round(48*scale)).png().toFile(`${folder}/${name}.png`);
  // Fit the complete supplied logo within Android's adaptive icon safe area.
  const side = Math.round(108*scale), inset = Math.round(18*scale);
  const art = await sharp(source).resize(side-inset*2).png().toBuffer();
  await sharp({create:{width:side,height:side,channels:4,background:'#0B1B34'}}).composite([{input:art,left:inset,top:inset}]).png().toFile(`${folder}/ic_launcher_foreground.png`);
}
await writeFile(`${res}/values/ic_launcher_background.xml`, '<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="ic_launcher_background">#0B1B34</color></resources>\n');
for (const entry of await readdir(res, {withFileTypes:true})) {
  if (!entry.isDirectory() || !entry.name.startsWith('drawable')) continue;
  const path = `${res}/${entry.name}/splash.png`;
  let size; try { size = await sharp(path).metadata(); } catch { continue; }
  const side = Math.round(Math.min(size.width,size.height)*0.28);
  const art = await sharp(source).resize(side).png().toBuffer();
  const splash = await sharp({create:{width:size.width,height:size.height,channels:3,background:'#0B1B34'}}).composite([{input:art,gravity:'centre'}]).png().toBuffer();
  await writeFile(path,splash);
}
const iosSplash = await sharp({create:{width:2732,height:2732,channels:3,background:'#0B1B34'}}).composite([{input:await sharp(source).resize(400).png().toBuffer(),gravity:'centre'}]).png().toBuffer();
for (const file of await readdir('ios/App/App/Assets.xcassets/Splash.imageset')) if(file.endsWith('.png')) await writeFile(`ios/App/App/Assets.xcassets/Splash.imageset/${file}`,iosSplash);
console.log('User-supplied PocketMinGW logo installed for Android, iOS and the app header.');
