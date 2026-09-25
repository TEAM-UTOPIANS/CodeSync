// Language catalog: labels, editor mode, logo, starter template and how each one runs.
//   runtime "browser": runs on your machine (WebAssembly / Web Worker / interpreter).
//   runtime "preview": rendered live in a sandboxed iframe.
//   runtime "remote":  compiled and run by a public compiler service (see providers.js).
// Starter programs read one line from stdin and greet it, so every language can be tried the same way.

const DEVICON = "https://cdn.jsdelivr.net/gh/devicons/devicon@v2.17.0/icons";
// Devicon URL for a language logo, or null when we have none.
export const iconUrl = (slug) => (slug ? `${DEVICON}/${slug}/${slug}-original.svg` : null);

// Build one catalog entry, filling in the defaults every language shares.
const L = (id, label, o) => ({ id, label, monaco: id, ext: id, icon: null, stdin: "Ada", ...o });

export const LANGUAGES = {
  javascript: L("javascript", "JavaScript", { runtime: "browser", group: "In your browser", ext: "js", icon: "javascript", template: `// Runs in a sandboxed Web Worker. console.log prints, input() reads a line of stdin.
const who = input() ?? "World";
console.log(\`Hello, \${who}!\`);

for (let i = 1; i <= 5; i++) {
  console.log(\`\${i} squared is \${i * i}\`);
}
` }),
  python: L("python", "Python", { runtime: "browser", group: "In your browser", ext: "py", icon: "python", template: `# Runs in your browser with Pyodide (CPython on WebAssembly).
# The first run downloads the runtime, later runs are instant.
name = input() or "World"
print(f"Hello, {name}!")

for i in range(1, 6):
    print(f"{i} squared is {i * i}")
` }),
  minilang: L("minilang", "MiniLang", { runtime: "browser", group: "In your browser", ext: "mini", template: `# MiniLang: a tiny teaching language.
START
PRINT "Enter your name:"
INPUT name
LET a = 6
LET b = 7
PRINT "Hello, " + name + "!"
PRINT "6 * 7 = " + (a * b)
IF a * b == 42 THEN
  PRINT "The answer."
ELSE
  PRINT "Something is off."
END
STOP
` }),
  html: L("html", "HTML / CSS / JS", { runtime: "preview", group: "In your browser", ext: "html", icon: "html5", stdin: "", template: `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { font: 16px system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; background: #0f172a; color: #e2e8f0; }
    button { font: inherit; padding: .7rem 1.2rem; border: 0; border-radius: 8px; background: #34d399; color: #04130c; cursor: pointer; }
    #count { font-size: 4rem; font-weight: 700; margin: 0 0 1rem; text-align: center; }
  </style>
</head>
<body>
  <main>
    <p id="count">0</p>
    <button id="add">Add one</button>
  </main>
  <script>
    let n = 0;
    document.getElementById("add").onclick = () => {
      document.getElementById("count").textContent = ++n;
    };
  </script>
</body>
</html>
` }),

  c: L("c", "C", { runtime: "remote", group: "Compiled", icon: "c", template: `#include <stdio.h>

int main(void) {
    char name[64] = "World";
    if (scanf("%63s", name) != 1) {
        /* no input: keep the default */
    }
    printf("Hello, %s!\\n", name);
    for (int i = 1; i <= 5; i++) {
        printf("%d squared is %d\\n", i, i * i);
    }
    return 0;
}
` }),
  cpp: L("cpp", "C++", { runtime: "remote", group: "Compiled", ext: "cpp", icon: "cplusplus", template: `#include <iostream>
#include <string>

int main() {
    std::string name;
    if (!std::getline(std::cin, name) || name.empty()) name = "World";
    std::cout << "Hello, " << name << "!\\n";
    for (int i = 1; i <= 5; i++) {
        std::cout << i << " squared is " << i * i << "\\n";
    }
}
` }),
  rust: L("rust", "Rust", { runtime: "remote", group: "Compiled", ext: "rs", icon: "rust", template: `use std::io::{self, BufRead};

fn main() {
    let mut line = String::new();
    io::stdin().lock().read_line(&mut line).unwrap();
    let name = line.trim();
    let name = if name.is_empty() { "World" } else { name };
    println!("Hello, {name}!");
    for i in 1..=5 {
        println!("{i} squared is {}", i * i);
    }
}
` }),
  go: L("go", "Go", { runtime: "remote", group: "Compiled", icon: "go", template: `package main

import (
	"bufio"
	"fmt"
	"os"
	"strings"
)

func main() {
	reader := bufio.NewReader(os.Stdin)
	name, _ := reader.ReadString('\\n')
	name = strings.TrimSpace(name)
	if name == "" {
		name = "World"
	}
	fmt.Printf("Hello, %s!\\n", name)
	for i := 1; i <= 5; i++ {
		fmt.Printf("%d squared is %d\\n", i, i*i)
	}
}
` }),
  zig: L("zig", "Zig", { runtime: "remote", group: "Compiled", icon: "zig", monaco: "plaintext", template: `const std = @import("std");

pub fn main() !void {
    const stdin = std.io.getStdIn().reader();
    const stdout = std.io.getStdOut().writer();
    var buf: [128]u8 = undefined;
    const line = try stdin.readUntilDelimiterOrEof(&buf, '\\n');
    const name = if (line) |l| std.mem.trim(u8, l, " \\r\\n") else "World";
    try stdout.print("Hello, {s}!\\n", .{name});
    var i: u32 = 1;
    while (i <= 5) : (i += 1) {
        try stdout.print("{d} squared is {d}\\n", .{ i, i * i });
    }
}
` }),
  nim: L("nim", "Nim", { runtime: "remote", group: "Compiled", icon: "nim", monaco: "plaintext", template: `let name = try: readLine(stdin) except EOFError: "World"
echo "Hello, ", name, "!"
for i in 1 .. 5:
  echo i, " squared is ", i * i
` }),
  crystal: L("crystal", "Crystal", { runtime: "remote", group: "Compiled", ext: "cr", icon: "crystal", monaco: "ruby", template: `name = gets || "World"
puts "Hello, #{name}!"
(1..5).each { |i| puts "#{i} squared is #{i * i}" }
` }),
  dlang: L("dlang", "D", { runtime: "remote", group: "Compiled", ext: "d", monaco: "cpp", template: `import std.stdio;
import std.string : strip;

void main() {
    string name = readln().strip();
    if (name.length == 0) name = "World";
    writefln("Hello, %s!", name);
    foreach (i; 1 .. 6) {
        writefln("%d squared is %d", i, i * i);
    }
}
` }),
  swift: L("swift", "Swift", { runtime: "remote", group: "Compiled", icon: "swift", template: `let name = readLine() ?? "World"
print("Hello, \\(name)!")
for i in 1...5 {
    print("\\(i) squared is \\(i * i)")
}
` }),
  pascal: L("pascal", "Pascal", { runtime: "remote", group: "Compiled", ext: "pas", template: `program Main;
var
  name: string;
  i: integer;
begin
  readln(name);
  writeln('Hello, ', name, '!');
  for i := 1 to 5 do
    writeln(i, ' squared is ', i * i);
end.
` }),
  fortran: L("fortran", "Fortran", { runtime: "remote", group: "Compiled", ext: "f90", monaco: "plaintext", template: `program main
  implicit none
  character(len=64) :: name
  integer :: i
  read (*, '(A)') name
  print '(A)', 'Hello, ' // trim(name) // '!'
  do i = 1, 5
    print '(I0,A,I0)', i, ' squared is ', i * i
  end do
end program main
` }),

  java: L("java", "Java", { runtime: "remote", group: "JVM and .NET", icon: "java", template: `import java.util.Scanner;

class Main {
    public static void main(String[] args) {
        Scanner in = new Scanner(System.in);
        String name = in.hasNextLine() ? in.nextLine() : "World";
        System.out.println("Hello, " + name + "!");
        for (int i = 1; i <= 5; i++) {
            System.out.println(i + " squared is " + i * i);
        }
    }
}
` }),
  kotlin: L("kotlin", "Kotlin", { runtime: "remote", group: "JVM and .NET", ext: "kt", icon: "kotlin", template: `fun main() {
    val name = readLine() ?: "World"
    println("Hello, $name!")
    for (i in 1..5) {
        println("$i squared is \${i * i}")
    }
}
` }),
  scala: L("scala", "Scala", { runtime: "remote", group: "JVM and .NET", icon: "scala", template: `object Main {
  def main(args: Array[String]): Unit = {
    val name = Option(scala.io.StdIn.readLine()).getOrElse("World")
    println(s"Hello, $name!")
    for (i <- 1 to 5) println(s"$i squared is \${i * i}")
  }
}
` }),
  groovy: L("groovy", "Groovy", { runtime: "remote", group: "JVM and .NET", ext: "groovy", icon: "groovy", monaco: "java", template: `def name = System.in.newReader().readLine() ?: "World"
println "Hello, \${name}!"
(1..5).each { println "\${it} squared is \${it * it}" }
` }),
  csharp: L("csharp", "C#", { runtime: "remote", group: "JVM and .NET", ext: "cs", icon: "csharp", template: `using System;

class Program {
    static void Main() {
        var name = Console.ReadLine() ?? "World";
        Console.WriteLine($"Hello, {name}!");
        for (int i = 1; i <= 5; i++) {
            Console.WriteLine($"{i} squared is {i * i}");
        }
    }
}
` }),

  ruby: L("ruby", "Ruby", { runtime: "remote", group: "Scripting", ext: "rb", icon: "ruby", template: `name = (gets || "World").strip
puts "Hello, #{name}!"
(1..5).each { |i| puts "#{i} squared is #{i * i}" }
` }),
  php: L("php", "PHP", { runtime: "remote", group: "Scripting", icon: "php", template: `<?php
$name = trim(fgets(STDIN) ?: "World");
echo "Hello, $name!\\n";
for ($i = 1; $i <= 5; $i++) {
    echo "$i squared is " . $i * $i . "\\n";
}
` }),
  perl: L("perl", "Perl", { runtime: "remote", group: "Scripting", ext: "pl", icon: "perl", template: `my $name = <STDIN> // "World";
chomp $name;
print "Hello, $name!\\n";
print "$_ squared is ", $_ * $_, "\\n" for 1 .. 5;
` }),
  lua: L("lua", "Lua", { runtime: "remote", group: "Scripting", icon: "lua", template: `local name = io.read("l") or "World"
print("Hello, " .. name .. "!")
for i = 1, 5 do
  print(i .. " squared is " .. i * i)
end
` }),
  bash: L("bash", "Bash", { runtime: "remote", group: "Scripting", ext: "sh", icon: "bash", monaco: "shell", template: `read -r name
name=\${name:-World}
echo "Hello, $name!"
for i in 1 2 3 4 5; do
  echo "$i squared is $((i * i))"
done
` }),
  typescript: L("typescript", "TypeScript", { runtime: "remote", group: "Scripting", ext: "ts", icon: "typescript", template: `declare const require: any;

const input: string = require("fs").readFileSync(0, "utf8").trim();
const who: string = input || "World";
console.log(\`Hello, \${who}!\`);
for (let i = 1; i <= 5; i++) {
  console.log(\`\${i} squared is \${i * i}\`);
}
` }),
  dart: L("dart", "Dart", { runtime: "remote", group: "Scripting", icon: "dart", template: `import 'dart:io';

void main() {
  final name = stdin.readLineSync() ?? 'World';
  print('Hello, $name!');
  for (var i = 1; i <= 5; i++) {
    print('$i squared is \${i * i}');
  }
}
` }),

  haskell: L("haskell", "Haskell", { runtime: "remote", group: "Functional and data", ext: "hs", icon: "haskell", monaco: "plaintext", template: `main :: IO ()
main = do
  name <- getLine
  putStrLn ("Hello, " ++ name ++ "!")
  mapM_ (\\i -> putStrLn (show i ++ " squared is " ++ show (i * i))) [1 .. 5 :: Int]
` }),
  ocaml: L("ocaml", "OCaml", { runtime: "remote", group: "Functional and data", ext: "ml", icon: "ocaml", monaco: "plaintext", template: `let () =
  let name = try input_line stdin with End_of_file -> "World" in
  Printf.printf "Hello, %s!\\n" name;
  for i = 1 to 5 do
    Printf.printf "%d squared is %d\\n" i (i * i)
  done
` }),
  julia: L("julia", "Julia", { runtime: "remote", group: "Functional and data", ext: "jl", icon: "julia", template: `name = readline()
isempty(name) && (name = "World")
println("Hello, $(name)!")
for i in 1:5
    println("$i squared is $(i^2)")
end
` }),
  r: L("r", "R", { runtime: "remote", group: "Functional and data", icon: "r", template: `con <- file("stdin")
name <- readLines(con, n = 1)
close(con)
if (length(name) == 0) name <- "World"
cat("Hello, ", name, "!\\n", sep = "")
for (i in 1:5) cat(i, "squared is", i^2, "\\n")
` }),
  sql: L("sql", "SQL (SQLite)", { runtime: "remote", group: "Functional and data", ext: "sql", icon: "sqlite", stdin: "", template: `CREATE TABLE languages (name TEXT, year INTEGER);
INSERT INTO languages VALUES ('C', 1972), ('Python', 1991), ('Rust', 2010);

SELECT name, year FROM languages ORDER BY year DESC;
` }),
  cobol: L("cobol", "COBOL", { runtime: "remote", group: "Functional and data", ext: "cob", monaco: "plaintext", template: `       IDENTIFICATION DIVISION.
       PROGRAM-ID. MAIN.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-NAME PIC X(30).
       01 WS-I    PIC 9 VALUE 1.
       01 WS-SQ   PIC 99.
       PROCEDURE DIVISION.
           ACCEPT WS-NAME.
           DISPLAY "Hello, " FUNCTION TRIM(WS-NAME) "!".
           PERFORM VARYING WS-I FROM 1 BY 1 UNTIL WS-I > 5
               COMPUTE WS-SQ = WS-I * WS-I
               DISPLAY WS-I " squared is " WS-SQ
           END-PERFORM.
           STOP RUN.
` }),
};

export const LANGUAGE_IDS = Object.keys(LANGUAGES);
export const GROUPS = ["In your browser", "Compiled", "JVM and .NET", "Scripting", "Functional and data"];
// The catalog arranged into the groups the site shows.
export const byGroup = () => GROUPS.map((g) => [g, LANGUAGE_IDS.filter((id) => LANGUAGES[id].group === g).map((id) => LANGUAGES[id])]);
// The file name a fresh file of this language gets.
export const fileName = (id) => `main.${LANGUAGES[id].ext}`;

/* ── Files: extension <-> language ───────────────────────────────── */
export const EXT_TO_LANG = {};
for (const l of Object.values(LANGUAGES)) EXT_TO_LANG[l.ext] ??= l.id;
const PLAIN_EXT = { css: "css", json: "json", md: "markdown", txt: "plaintext", h: "c", hpp: "cpp", yml: "yaml", yaml: "yaml", csv: "plaintext" };
// The extension of a file name, lower case, without the dot.
export const extOf = (name) => (name.includes(".") ? name.split(".").pop().toLowerCase() : "");
// Which language a file name implies, or null when we cannot run it.
export const languageForFile = (name) => EXT_TO_LANG[extOf(name)] ?? null;
// The Monaco mode for a file, falling back to plain text.
export const monacoForFile = (name) => { const id = languageForFile(name); return id ? LANGUAGES[id].monaco : PLAIN_EXT[extOf(name)] ?? "plaintext"; };
// File names stay flat: letters, numbers, dots, dashes and spaces.
export const validFileName = (name) => /^[\w][\w .-]{0,59}$/.test(name);

/* ── Does this program read from standard input? ─────────────────
   Compiler services take their input before the program starts, so the terminal has to know how
   many lines to collect first. Counting the read calls in the source is a rough guess, but it is
   right for the kind of program people paste into a shared editor, and the visitor can always
   stop early. Languages that run in the browser are not listed here: they simply ask when they
   run out. */
const INPUT_READS = {
  c: /\b(?:scanf|fscanf|getchar|gets|fgets|getline)\s*\(/g,
  cpp: /\b(?:scanf|getline|getchar|fgets)\s*\(|\bcin\s*>>/g,
  csharp: /Console\s*\.\s*ReadLine\s*\(/g,
  java: /\.\s*(?:nextLine|nextInt|nextDouble|nextFloat|nextLong|next|readLine)\s*\(/g,
  kotlin: /\breadLine\s*\(|\breadln\s*\(/g,
  scala: /\breadLine\s*\(|\breadInt\s*\(/g,
  groovy: /\breadLine\s*\(/g,
  rust: /\bread_line\s*\(/g,
  go: /\b(?:Scan|Scanln|Scanf|ReadString|ReadLine)\s*\(/g,
  zig: /\breadUntilDelimiter\w*\s*\(/g,
  nim: /\breadLine\s*\(/g,
  crystal: /\bgets\b/g,
  dlang: /\breadln\s*\(/g,
  swift: /\breadLine\s*\(/g,
  pascal: /\breadln\s*\(|\bread\s*\(/gi,
  fortran: /\bread\s*\(/gi,
  cobol: /\bACCEPT\b/gi,
  ruby: /\bgets\b/g,
  php: /\b(?:fgets|readline|stream_get_line)\s*\(/g,
  perl: /<STDIN>/g,
  lua: /\bio\s*\.\s*read\s*\(/g,
  bash: /^\s*read\b/gm,
  typescript: /\breadFileSync\s*\(\s*0|\bprompt\s*\(/g,
  dart: /\breadLineSync\s*\(/g,
  haskell: /\bgetLine\b/g,
  ocaml: /\binput_line\b/g,
  julia: /\breadline\s*\(/g,
  r: /\breadLines\s*\(|\breadline\s*\(/g,
};

/** How many lines of standard input this source looks like it wants. Zero when it reads nothing. */
export function countInputReads(languageId, source) {
  const pattern = INPUT_READS[languageId];
  if (!pattern) return 0;
  // Ignore anything inside a comment or a string, so a printed prompt is not mistaken for a read.
  const stripped = String(source)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)(?:\/\/|#|--)[^\n]*/g, "$1")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
  pattern.lastIndex = 0;
  return (stripped.match(pattern) ?? []).length;
}
