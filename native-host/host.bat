@echo off
rem Wrapper Chrome launches as the native messaging host. It just runs host.js
rem with Node. Requires Node.js to be installed and on PATH.
node "%~dp0host.js"
