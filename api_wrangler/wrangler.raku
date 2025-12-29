use HTTP::Tiny;

class HostMachine {
    has Str $.ip-address;

    method get(Str $param) {
        my $url = "http://{$.ip-address}/api/data?{$param}";
        return HTTP::Tiny.new.get($url)<content>.decode;
    }

    method set(Str $param, Str $value) {
        my $url = "http://{$.ip-address}/api/data?{$param}={$value}";
        return HTTP::Tiny.new.get($url)<content>.decode;
    }
}

sub get-ip-address() {
    my $env-file = '.env';
    my $ip;

    # Check environment variable first
    $ip = %*ENV<HOST_IP> if %*ENV<HOST_IP>:exists;

    # Check .env file
    if !$ip && $env-file.IO.e {
        for $env-file.IO.lines -> $line {
            if $line ~~ /^ 'HOST_IP=' (.+) $/ {
                $ip = ~$0;
                last;
            }
        }
    }

    # Prompt user if not found
    if !$ip {
        print "Enter Host IP address: ";
        $ip = $*IN.get;

        # Validate IP format (basic check)
        unless $ip ~~ /^ \d+ '.' \d+ '.' \d+ '.' \d+ $/ {
            die "Invalid IP address format.";
        }
        
        # Save to .env
        spurt $env-file, "HOST_IP=$ip\n";
        say "IP address saved to .env";
    }

    return $ip;
}


multi sub MAIN() {
    my HostMachine $host .= new(ip-address => get-ip-address());

    say $host.get('monitor.figure-color');
    say $host.set('monitor.figure-color', 'WHITE');
    say $host.get('monitor.figure-color');
}

multi sub MAIN(Str $ip) {
    if $ip eq 'clear' {
        my $env-file = '.env';
        if $env-file.IO.e {
            $env-file.IO.unlink;
            say ".env file deleted.";
        }
        else {
            say ".env file does not exist.";
        }
        return;
    }

    my HostMachine $host .= new(ip-address => $ip);

    say $host.get('monitor.figure-color');
    say $host.set('monitor.figure-color', 'WHITE');
    say $host.get('monitor.figure-color');
}
