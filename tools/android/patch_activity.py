#!/usr/bin/env python3
"""Adds our own native plugin (the system bars colour) to the generated Android project.

The android/ folder is generated in CI by `npx cap add android` and never committed, so what the
template lacks is applied here, idempotently. Usage: patch_activity.py <android dir> <plugin.java>

Copies the plugin next to MainActivity and registers it there, before `super.onCreate`, which is
where Capacitor wants plugins registered. Fails loudly when MainActivity has a shape this does not
know, instead of silently shipping an app whose bars have the wrong colour.
"""
import glob
import os
import re
import sys

android_dir, plugin_src = sys.argv[1], sys.argv[2]
plugin_class = os.path.splitext(os.path.basename(plugin_src))[0]

matches = glob.glob(os.path.join(android_dir, "app/src/main/java/**/MainActivity.java"), recursive=True)
if len(matches) != 1:
    print(f"expected exactly one MainActivity.java, found {matches}")
    sys.exit(1)
main = matches[0]
text = open(main, encoding="utf-8").read()

package = re.search(r"^package\s+([\w.]+);", text, re.M)
if not package:
    print("MainActivity.java has no package line")
    print(text)
    sys.exit(1)

# The plugin is written for the package ada.nawy.app; follow whatever the project really uses.
plugin_text = open(plugin_src, encoding="utf-8").read()
plugin_text = re.sub(r"^package\s+[\w.]+;", f"package {package.group(1)};", plugin_text, count=1, flags=re.M)
open(os.path.join(os.path.dirname(main), plugin_class + ".java"), "w", encoding="utf-8").write(plugin_text)

register = f"registerPlugin({plugin_class}.class);"
if register in text:
    print("plugin already registered")
elif re.search(r"super\.onCreate\(", text):
    text, n = re.subn(r"(\n[ \t]*)super\.onCreate\(", lambda m: f"{m.group(1)}{register}{m.group(1)}super.onCreate(", text, count=1)
    if n != 1:
        print("could not place the registration before super.onCreate")
        print(text)
        sys.exit(1)
    open(main, "w", encoding="utf-8").write(text)
else:
    # A bare `class MainActivity extends BridgeActivity {}`: add the override ourselves.
    text, n = re.subn(
        r"(class\s+MainActivity\s+extends\s+BridgeActivity\s*\{)",
        r"\1\n    @Override\n    public void onCreate(android.os.Bundle savedInstanceState) {\n"
        rf"        {register}\n        super.onCreate(savedInstanceState);\n    }}\n",
        text,
        count=1,
    )
    if n != 1:
        print("unexpected MainActivity shape")
        print(text)
        sys.exit(1)
    open(main, "w", encoding="utf-8").write(text)

print(open(main, encoding="utf-8").read())
print(f"registered {plugin_class} in {main}")
