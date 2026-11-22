import { test, expect } from '@playwright/test';
test.beforeEach(async ({page}) => {
  // Exercise the APIs missing from Android 12's factory WebView in every user flow.
  await page.addInitScript(() => {
    Object.defineProperty(crypto, 'randomUUID', {value: undefined});
    Object.defineProperty(window, 'structuredClone', {value: undefined});
    Object.defineProperty(Object, 'hasOwn', {value: undefined});
  });
});
test('phone editing, tabs, persistence, project isolation and test bench', async ({page}) => {
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'PocketMinGW'})).toBeVisible();
  await expect(page.getByRole('tab',{name:'main.cpp'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Hoàn tác',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Tạo file',exact:true}).click();
  await page.getByLabel('Đường dẫn file').fill('helper.h');
  await page.getByRole('button',{name:'Tạo',exact:true}).click();
  await page.getByRole('textbox',{name:'Mã nguồn C++'}).fill('// saved header');
  await expect(page.getByRole('button',{name:'Hoàn tác',exact:true})).toBeEnabled();
  await page.getByRole('tab',{name:'main.cpp'}).click();
  await expect(page.getByRole('textbox',{name:'Mã nguồn C++'})).toContainText('#include');
  await page.getByRole('tab',{name:'helper.h'}).click();
  await expect(page.getByRole('textbox',{name:'Mã nguồn C++'})).toContainText('// saved header');
  await page.getByRole('button',{name:'Lưu tất cả'}).click();
  await expect(page.getByText('Đã lưu trên máy')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox',{name:'Mã nguồn C++'})).toContainText('// saved header');
  await page.getByRole('button',{name:'Bộ test',exact:true}).click();
  await page.getByRole('button',{name:'Thêm test'}).click();
  await page.getByLabel('Input test 2').fill('0');
  await page.getByLabel('Expected test 2').fill('0');
  await expect(page.getByRole('heading',{name:'Test 2'})).toBeVisible();
  await page.getByRole('button',{name:'File',exact:true}).click();
  await page.getByRole('button',{name:'Tạo project'}).click();
  await page.getByLabel('Tên project').fill('Project riêng');
  await page.getByRole('button',{name:'Tạo',exact:true}).click();
  await expect(page.getByRole('tab',{name:'helper.h'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Project riêng'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('reject path traversal and explain browser execution limit',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Tạo file',exact:true}).click();
  await page.getByLabel('Đường dẫn file').fill('../outside.cpp');
  await page.getByRole('button',{name:'Tạo',exact:true}).click();
  await expect(page.getByText('Tên file không hợp lệ.',{exact:false})).toBeVisible();
  await page.getByRole('button',{name:'Đóng hộp thoại'}).click();
  await page.getByRole('button',{name:'Chạy',exact:true}).click();
  await expect(page.getByText('Bản xem trước chỉ hỗ trợ soạn thảo.',{exact:false})).toBeVisible();
});

test('fixed phone shell and keyboard layout at narrow widths', async ({page}) => {
  for (const width of [320, 375, 430]) {
    await page.setViewportSize({width, height:812});
    await page.goto('/');
    await page.getByRole('textbox', {name:'Mã nguồn C++'}).fill('// ' + 'long source line '.repeat(100));
    const shell = () => page.evaluate(() => ({
      width: document.documentElement.scrollWidth, x: scrollX, y: scrollY,
      header: document.querySelector('.topbar')!.getBoundingClientRect().top,
      font: parseFloat(getComputedStyle(document.querySelector('.cm-content')!).fontSize),
    }));
    expect(await shell()).toEqual({width, x:0, y:0, header:0, font:16});
    // CSS contract only; the simulator test exercises real native keyboard events.
    await page.evaluate(() => { document.documentElement.dataset.keyboard = 'open'; });
    await page.setViewportSize({width, height:440});
    await expect(page.locator('.bottom-nav')).toBeHidden();
    await expect(page.getByRole('button', {name:'Ẩn bàn phím'})).toBeVisible();
    await expect.poll(() => page.locator('.coding-keys').evaluate(e => e.getBoundingClientRect().bottom)).toBe(440);
    expect(await shell()).toEqual({width, x:0, y:0, header:0, font:16});
    await page.getByRole('button', {name:'Ẩn bàn phím'}).click();
    await page.evaluate(() => { document.documentElement.dataset.keyboard = 'closed'; });
    await page.setViewportSize({width, height:812});
    await expect(page.locator('.bottom-nav')).toBeVisible();
  }
});

test('HSG build mode defaults to active file and persists project mode', async ({page}) => {
  await page.goto('/');
  await page.getByRole('button', {name:'Thiết lập',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Biên dịch',exact:true})).toHaveValue('active');
  await page.getByRole('combobox',{name:'Biên dịch',exact:true}).selectOption('project');
  await page.getByRole('button', {name:'Lưu tất cả'}).click();
  await page.reload();
  await expect(page.getByRole('combobox',{name:'Biên dịch',exact:true})).toHaveValue('project');
  await page.getByRole('combobox',{name:'Biên dịch',exact:true}).selectOption('active');
  await page.getByRole('button', {name:'Kết quả',exact:true}).click();
  await expect(page.getByText('Chạy file main.cpp.',{exact:false})).toBeVisible();
});
