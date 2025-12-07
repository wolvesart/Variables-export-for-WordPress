const chokidar = require('chokidar');
const { exec } = require('child_process');
const path = require('path');

const srcDir = path.join(__dirname, 'src');

console.log('👀 Watching for changes in src/...');
console.log('   Press Ctrl+C to stop\n');

// Run initial build
runBuild();

// Watch for changes
const watcher = chokidar.watch(srcDir, {
    ignored: /node_modules/,
    persistent: true,
    ignoreInitial: true
});

watcher
    .on('change', (filePath) => {
        console.log(`\n📝 Changed: ${path.relative(__dirname, filePath)}`);
        runBuild();
    })
    .on('add', (filePath) => {
        console.log(`\n➕ Added: ${path.relative(__dirname, filePath)}`);
        runBuild();
    })
    .on('unlink', (filePath) => {
        console.log(`\n➖ Removed: ${path.relative(__dirname, filePath)}`);
        runBuild();
    });

function runBuild() {
    exec('node build.js', (error, stdout, stderr) => {
        if (error) {
            console.error(`❌ Build error: ${error.message}`);
            return;
        }
        if (stderr) {
            console.error(`⚠️  ${stderr}`);
        }
        console.log(stdout);
    });
}
