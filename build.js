const fs = require('fs');
const path = require('path');
const sass = require('sass');

// Paths
const srcDir = path.join(__dirname, 'src');
const scssDir = path.join(srcDir, 'scss');
const jsDir = path.join(srcDir, 'js');
const outputFile = path.join(__dirname, 'ui.html');

// Compile SCSS
function buildCSS() {
    const appScss = path.join(scssDir, 'app.scss');

    if (!fs.existsSync(appScss)) {
        console.error('Error: app.scss not found');
        process.exit(1);
    }

    try {
        const result = sass.compile(appScss, {
            style: 'compressed'
        });
        return result.css;
    } catch (error) {
        console.error(`Error compiling app.scss:`, error.message);
        process.exit(1);
    }
}

// Read JavaScript file
function buildJS() {
    const jsFile = path.join(jsDir, 'ui.js');
    if (fs.existsSync(jsFile)) {
        return fs.readFileSync(jsFile, 'utf8');
    } else {
        console.error('Error: ui.js not found');
        process.exit(1);
    }
}

// Read the bundled font and inline it as a base64 @font-face, so the UI needs no
// network access to Google Fonts — the plugin then works fully offline.
function buildFontFace() {
    const fontFile = path.join(srcDir, 'fonts', 'CascadiaCode.woff2');
    if (!fs.existsSync(fontFile)) {
        console.warn('⚠️  Font not found (src/fonts/CascadiaCode.woff2) — skipping @font-face embedding');
        return '';
    }
    const base64 = fs.readFileSync(fontFile).toString('base64');
    return "@font-face{font-family:'Cascadia Code';font-style:normal;font-weight:200 700;"
        + "font-display:swap;src:url(data:font/woff2;base64," + base64 + ") format('woff2');}\n";
}

// Read vendored third-party library (jszip) to inline it instead of loading from a CDN.
// This keeps ui.html self-contained and lets the export work fully offline.
function buildVendorJS() {
    const jszipFile = path.join(__dirname, 'node_modules', 'jszip', 'dist', 'jszip.min.js');
    if (fs.existsSync(jszipFile)) {
        return fs.readFileSync(jszipFile, 'utf8');
    } else {
        console.error('Error: jszip not found. Run `npm install` first.');
        process.exit(1);
    }
}

// Main build function
function build() {
    console.log('Building ui.html...');

    // Read template
    const templatePath = path.join(srcDir, 'index.html');
    if (!fs.existsSync(templatePath)) {
        console.error('Error: src/index.html not found');
        process.exit(1);
    }

    let html = fs.readFileSync(templatePath, 'utf8');

    // Build CSS and JS (prefix the CSS with the inlined @font-face)
    const css = buildFontFace() + buildCSS();
    const js = buildJS();
    const vendorJs = buildVendorJS();

    // Replace placeholders
    html = html.replace('/* BUILD_CSS_PLACEHOLDER */', () => css);
    html = html.replace('/* BUILD_VENDOR_JS_PLACEHOLDER */', () => vendorJs);
    html = html.replace('/* BUILD_JS_PLACEHOLDER */', () => js);

    // Write output
    fs.writeFileSync(outputFile, html, 'utf8');

    console.log(`✅ ui.html built successfully!`);
    console.log(`   - SCSS: app.scss compiled`);
    console.log(`   - JS: ui.js included`);
    console.log(`   - Output: ${outputFile}`);
}

// Run build
build();
