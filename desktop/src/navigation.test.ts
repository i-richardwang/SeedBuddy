import { pathToFileURL } from "node:url";

import { expect, test } from "bun:test";

import { destination, opensInBrowser } from "./navigation";

const SERVER = "https://seedbuddy.example.org";
const CONNECT_PAGE = "/Applications/Seed Buddy.app/dist/connect.html";
const connectPage = pathToFileURL(CONNECT_PAGE).href;

test("a page of the workbench stays in the window", () => {
  expect(destination(`${SERVER}/experiments/3`, SERVER, CONNECT_PAGE)).toEqual({
    kind: "workbench",
  });
});

test("another site opens in the browser", () => {
  for (const url of [
    "https://docs.example.com/guide",
    "http://seedbuddy.example.org/",
    "https://seedbuddy.example.org.evil.example/",
  ])
    expect(destination(url, SERVER, CONNECT_PAGE)).toEqual({
      kind: "browser",
      url,
    });
  expect(destination(`${SERVER}/`, null, CONNECT_PAGE)).toEqual({
    kind: "browser",
    url: `${SERVER}/`,
  });
});

test("the connect page's form hands over the address typed into it", () => {
  expect(
    destination(
      `${connectPage}?server=lab.example.org%3A3000`,
      null,
      CONNECT_PAGE,
    ),
  ).toEqual({ kind: "address", typed: "lab.example.org:3000" });
  expect(destination(`${connectPage}?server=`, SERVER, CONNECT_PAGE)).toEqual({
    kind: "address",
    typed: "",
  });
});

test("a file dropped on the window, and anything else, opens nowhere", () => {
  for (const url of [
    "file:///Users/someone/Pictures/dish.jpg",
    "file:///Users/someone/Pictures/dish.jpg?server=lab.example.org",
    connectPage,
    "file://elsewhere/Applications/connect.html?server=lab.example.org",
    "javascript:alert(1)",
    "mailto:someone@example.org",
    "not an address",
  ])
    expect(destination(url, SERVER, CONNECT_PAGE)).toEqual({
      kind: "nowhere",
    });
});

test("only a web address opens in the browser", () => {
  expect(opensInBrowser("https://docs.example.com/guide")).toBe(true);
  expect(opensInBrowser("file:///etc/hosts")).toBe(false);
  expect(opensInBrowser("smb://server/share")).toBe(false);
});
