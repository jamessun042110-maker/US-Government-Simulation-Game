#!/bin/sh
# Every engine suite, in one go. Node only — no browser, no server.
#   sh tests/run-all.sh
#
# The runner counts ^PASS/^FAIL lines, which on its own is a lie detector with
# one blind spot: a file that *crashes* halfway prints fewer PASS lines and no
# FAIL line at all, so a real breakage reads as "the count went down a bit" and
# a green total. Two guards close it:
#
#   - a non-zero exit is a failure, whatever the file printed before it;
#   - a file that asserted nothing is a failure, unless it is one of the three
#     that measure rather than assert.
NODE="${NODE:-$HOME/.local/node-v22.11.0-darwin-arm64/bin/node}"
cd "$(dirname "$0")" || exit 1

# These print measurements, not assertions. 0/0 is their correct output.
is_silent() {
  case "$1" in money.mjs|wardup.mjs) return 0 ;; *) return 1 ;; esac
}

pass=0; fail=0; broken=0
for f in *.mjs; do
  out=$("$NODE" "$f" 2>&1); code=$?
  p=$(printf '%s' "$out" | grep -c '^PASS')
  n=$(printf '%s' "$out" | grep -c '^FAIL')
  pass=$((pass + p)); fail=$((fail + n))
  note=''
  if [ "$code" -ne 0 ]; then
    broken=$((broken + 1)); note=" CRASHED (exit $code)"
  elif [ "$p" -eq 0 ] && [ "$n" -eq 0 ] && ! is_silent "$f"; then
    broken=$((broken + 1)); note=' ASSERTED NOTHING'
  fi
  printf '%-16s %3d pass %2d fail%s\n' "$f" "$p" "$n" "$note"
  [ "$n" -gt 0 ] && printf '%s\n' "$out" | grep '^FAIL'
  # A crash's last words are the diagnosis; print the tail rather than make
  # somebody re-run the file by hand to see it.
  [ "$code" -ne 0 ] && printf '%s\n' "$out" | tail -12 | sed 's/^/    | /'
done

printf '\n%d passed, %d failed' "$pass" "$fail"
[ "$broken" -gt 0 ] && printf ', %d file(s) broken' "$broken"
printf '\n'
[ "$fail" -eq 0 ] && [ "$broken" -eq 0 ]
