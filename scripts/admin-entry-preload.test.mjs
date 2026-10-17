import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'vitest';
import { build } from 'vite';
import config from '../vite.config.mjs';

const temporaryDirectories = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true })));
});
const resolve = (filename, dependencies, hostType = 'js') =>
  config.build.modulePreload.resolveDependencies(filename, dependencies, { hostId: 'assets/index-test.js', hostType });

describe('Admin entry preload recovery', () => {
  it('omits only the Admin entry itself while retaining its ordered dependencies and styles', () => {
    const filename = 'assets/AdminApp-test.js';
    const dependencies = Object.freeze([filename, 'assets/vendor-react-test.js', 'assets/inquiryService-test.js', 'assets/AdminApp-test.css']);
    assert.deepEqual(resolve(filename, dependencies), dependencies.slice(1));
    assert.equal(dependencies.length, 4);
  });

  it('leaves HTML entry preloads untouched', () => {
    const dependencies = ['assets/AdminApp-test.js', 'assets/vendor-react-test.js'];
    assert.equal(resolve('assets/AdminApp-test.js', dependencies, 'html'), dependencies);
  });

  it('leaves other optional views and similarly named chunks untouched', () => {
    for (const filename of ['assets/ReportView-test.js', 'assets/DayView-test.js', 'assets/AnnouncementsPage-test.js',
      'assets/BookshelfView-test.js', 'assets/OtherAdminApp-test.js', 'assets/AdminApp-test.css']) {
      const dependencies = [filename, 'assets/vendor-react-test.js'];
      assert.equal(resolve(filename, dependencies), dependencies);
    }
  });

  it('keeps native lazy imports and CSS gating in real Vite output without preloading the Admin entry', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studyplanner-admin-preload-'));
    temporaryDirectories.push(root);
    const files = {
      'index.html': '<script type="module" src="/main.js"></script>',
      'main.js': 'window.openAdmin = () => import("./AdminApp.js"); window.openReport = () => import("./ReportView.js");',
      'AdminApp.js': 'import "./admin.css"; export const adminReady = true;',
      'ReportView.js': 'import "./report.css"; export const reportReady = true;',
      'admin.css': '.admin-proof { color: red; }',
      'report.css': '.report-proof { color: blue; }',
    };
    await Promise.all(Object.entries(files).map(([name, source]) => fs.writeFile(path.join(root, name), source)));
    const result = await build({ configFile: false, root, logLevel: 'silent',
      build: { write: false, minify: false, modulePreload: config.build.modulePreload } });
    const entry = result.output.find(item => item.type === 'chunk' && item.isEntry);
    const admin = result.output.find(item => item.type === 'chunk' && item.name === 'AdminApp');
    const report = result.output.find(item => item.type === 'chunk' && item.name === 'ReportView');
    assert.ok(entry && admin && report);
    assert.ok(entry.dynamicImports.includes(admin.fileName));
    assert.ok(entry.dynamicImports.includes(report.fileName));
    const dependencyList = entry.code.match(/\.f\s*\|\|\s*\([^=]+=\s*(\[[^\]]*\])/);
    assert.ok(dependencyList, 'Vite must still emit dependency-gated lazy imports');
    const preloads = JSON.parse(dependencyList[1]);
    assert.ok(!preloads.includes(admin.fileName));
    assert.ok(preloads.includes(report.fileName));
    for (const css of admin.viteMetadata.importedCss) assert.ok(preloads.includes(css));
    assert.equal(admin.viteMetadata.importedCss.size, 1);
    assert.match(entry.code, /return baseModule\(\)\.catch\(handlePreloadError\)/);
    assert.match(entry.code, /link\.addEventListener\("load", res\)/);
  });
});
