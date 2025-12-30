use Cro::HTTP::Router;
use Cro::HTTP::Router::WebSocket;
use Cro::HTTP::Server;
use Cro::WebSocket::Message;
use JSON::Fast;

my %clients; # username => Array[Supplier]
my %user-texts; # username => current text
my %user-themes; # username => { color => Str, font => Str, bg => Str }
my %user-status; # username => status ('active', 'away')
my %user-sessions; # username => session-id

my %default-theme = (color => '#00ff00', font => 'courier', bg => '#000000');
my $application = route {
    get -> {
        static 'public/index.html';
    }
    
    get -> 'style.css' {
        static 'public/style.css';
    }
    
    get -> 'app.js' {
        static 'public/app.js';
    }
    
    get -> 'chat' {
        web-socket -> $incoming {
            supply {
                my $current-user;
                my $client-supply = Supplier.new;
                
                whenever $incoming -> $message {
                    my $text = await $message.body-text;
                    my $data = from-json($text);
                    
                    given $data<type> {
                        when 'join' {
                            $current-user = $data<user>;
                            
                            # Reject empty usernames
                            unless $current-user && $current-user.trim {
                                say "Rejected join attempt with empty username";
                                next;
                            }
                            
                            my $session-id = $data<sessionId> // '';

                            # Check for existing user
                            if %clients{$current-user}:exists {
                                # If session ID matches, allow additional connection
                                if %user-sessions{$current-user} eq $session-id {
                                    say "User '$current-user' added connection (session match)";
                                } else {
                                    say "Rejected join attempt: username '$current-user' already taken (session mismatch)";
                                    $client-supply.emit(to-json({
                                        type => 'error',
                                        message => 'username already taken'
                                    }));
                                    next;
                                }
                            }
                            
                            %clients{$current-user} //= Array.new;
                            %clients{$current-user}.push($client-supply);
                            
                            # Only initialize these if it's the first connection
                            unless %user-texts{$current-user}:exists {
                                %user-texts{$current-user} = '';
                                %user-themes{$current-user} = $data<theme> // %default-theme;
                                %user-status{$current-user} = 'active';
                                %user-sessions{$current-user} = $session-id;
                            }
                            
                            # Send current users list to new user
                            $client-supply.emit(to-json({
                                type => 'users',
                                users => %clients.keys.sort.map(-> $u {
                                    {
                                        user   => $u,
                                        text   => (%user-texts{$u} // ''),
                                        theme  => (%user-themes{$u} // %default-theme),
                                        status => (%user-status{$u} // 'active')
                                    }
                                }).Array
                            }));
                            
                            # Send user count to all
                            broadcast-to-all({
                                type => 'user-count',
                                count => %clients.elems
                            });
                            
                            # Notify others of new user (and other connections of same user)
                            broadcast-to-others($current-user, $client-supply, {
                                type => 'join',
                                user => $current-user,
                                theme => (%user-themes{$current-user} // %default-theme)
                            });
                            
                            say "User joined: $current-user (total users: {%clients.elems})";
                        }
                        
                        when 'update' {
                            # Store and broadcast text update
                            %user-texts{$data<user>} = $data<text>;
                            %user-themes{$data<user>} = $data<theme> if $data<theme>;
                            
                            broadcast-to-others($data<user>, $client-supply, {
                                type => 'update',
                                user => $data<user>,
                                text => $data<text>,
                                theme => (%user-themes{$data<user>} // %default-theme)
                            });
                        }

                        when 'status' {
                            %user-status{$data<user>} = $data<status>;
                            broadcast-to-others($data<user>, $client-supply, {
                                type => 'status',
                                user => $data<user>,
                                status => $data<status>
                            });
                        }

                        when 'fireworks' {
                            if %clients{$data<target>}:exists {
                                for %clients{$data<target>}.list -> $s {
                                    $s.emit(to-json({
                                        type => 'fireworks',
                                        from => $data<from>
                                    }));
                                }
                            }
                        }
                        
                        when 'leave' {
                            handle-disconnect($data<user>, $client-supply);
                        }
                    }
                }
                
                # Provide messages for this client
                whenever $client-supply.Supply {
                    emit Cro::WebSocket::Message.new($_);
                }
                
                # Clean up when client disconnects
                QUIT {
                    handle-disconnect($current-user, $client-supply) if $current-user;
                }
            }
        }
    }
}

sub broadcast-to-all($data) {
    my $json = to-json($data);
    for %clients.values -> $supplies {
        for $supplies.list -> $s {
            $s.emit($json);
        }
    }
}

sub broadcast-to-others($sender, $sender-supply, $data) {
    my $json = to-json($data);
    for %clients.kv -> $user, $supplies {
        for $supplies.list -> $s {
            if $user ne $sender || $s !=== $sender-supply {
                $s.emit($json);
            }
        }
    }
}

sub handle-disconnect($user, $client-supply) {
    return unless $user;
    return unless %clients{$user}:exists;
    
    my $supplies = %clients{$user};
    my $idx = $supplies.first($client-supply, :k);
    
    if $idx.defined {
        $supplies.splice($idx, 1);
    }

    if $supplies.elems == 0 {
        %clients{$user}:delete;
        %user-texts{$user}:delete;
        %user-themes{$user}:delete;
        %user-status{$user}:delete;
        %user-sessions{$user}:delete;
        
        broadcast-to-all({
            type => 'leave',
            user => $user
        });
        
        broadcast-to-all({
            type => 'user-count',
            count => %clients.elems
        });
        
        say "User left: $user (total users: {%clients.elems})";
    } else {
        say "User connection closed: $user (remaining connections: {$supplies.elems})";
    }
}

my Cro::Service $service = Cro::HTTP::Server.new(
    :host<0.0.0.0>, :port<3000>, :$application
);

$service.start;

say "💬 talkomatic server running at http://0.0.0.0:3000";
say "press Ctrl+C to stop";

react whenever signal(SIGINT) {
    say "\n👋 shutting down...";
    $service.stop;
    exit;
}
