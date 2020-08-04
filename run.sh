#!/bin/bash
#
_CLEAR=("build/*")
#
function clear() {
 echo "- clear"
 for i in "${_CLEAR[@]}"; do echo "  > $i"; rm -rf $i; done
 echo "finished - clear"
}
function build() {
 LANG="$1"
 echo "- build '$LANG'"
 echo "  ... executing"
 export GOOGLE_APPLICATION_CREDENTIALS=credentials.json
 node index.js "$LANG"
}

#
case $1 in
    clear )
        eval "$1";
        exit $?
    ;;
    ?? ) #lang
      eval "build \"$1\"";
      exit $?
    ;;
    * )
      echo "usage:"
      echo "$0 clear"
      echo "$0 en | ru | nl"
      exit 1
esac
