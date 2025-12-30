# hello-raku

Using WSL2 

1. clone repo and open in VSCode
1. install Raku VSCode extension
1. `curl https://rakubrew.org/install-on-perl.sh | sh`
1. `echo 'eval "$(/home/$USER/.rakubrew/bin/rakubrew init Bash)"' >> ~/.bashrc`
1. `source ~/.bashrc`
1. `rakubrew download`
1. `raku -e 'say "Now running {$*RAKU.compiler.version}!"'` > Now running 2025.12!
