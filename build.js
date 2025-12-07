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

    // Build CSS and JS
    const css = buildCSS();
    const js = buildJS();

    // Replace placeholders
    html = html.replace('/* BUILD_CSS_PLACEHOLDER */', css);
    html = html.replace('/* BUILD_JS_PLACEHOLDER */', js);

    // Write output
    fs.writeFileSync(outputFile, html, 'utf8');

    console.log(`✅ ui.html built successfully!`);
    console.log(`   - SCSS: app.scss compiled`);
    console.log(`   - JS: ui.js included`);
    console.log(`   - Output: ${outputFile}`);
}

// Run build
build();
