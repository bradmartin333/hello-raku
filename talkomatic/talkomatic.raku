use Cro::HTTP::Router;
use Cro::HTTP::Router::WebSocket;
use Cro::HTTP::Server;
use Cro::WebSocket::Message;
use JSON::Fast;

my %clients; # username => client-supply
my %user-texts; # username => current text
my %user-themes; # username => { color => Str, font => Str, bg => Str }

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
                            %clients{$current-user} = $client-supply;
                            %user-texts{$current-user} = '';
                            %user-themes{$current-user} = $data<theme> // %default-theme;
                            
                            # Send current users list to new user
                            $client-supply.emit(to-json({
                                type => 'users',
                                users => %clients.keys.sort.map(-> $u {
                                    {
                                        user  => $u,
                                        text  => (%user-texts{$u} // ''),
                                        theme => (%user-themes{$u} // %default-theme)
                                    }
                                }).Array
                            }));
                            
                            # Send user count to all
                            broadcast-to-all({
                                type => 'user-count',
                                count => %clients.elems
                            });
                            
                            # Notify others of new user
                            broadcast-to-others($current-user, {
                                type => 'join',
                                user => $current-user,
                                theme => (%user-themes{$current-user} // %default-theme)
                            });
                            
                            say "User joined: $current-user (total: {%clients.elems})";
                        }
                        
                        when 'update' {
                            # Store and broadcast text update
                            %user-texts{$data<user>} = $data<text>;
                            %user-themes{$data<user>} = $data<theme> if $data<theme>;
                            
                            broadcast-to-others($data<user>, {
                                type => 'update',
                                user => $data<user>,
                                text => $data<text>,
                                theme => (%user-themes{$data<user>} // %default-theme)
                            });
                        }
                        
                        when 'leave' {
                            handle-disconnect($data<user>);
                        }
                    }
                }
                
                # Provide messages for this client
                whenever $client-supply.Supply {
                    emit Cro::WebSocket::Message.new($_);
                }
                
                # Clean up when client disconnects
                QUIT {
                    handle-disconnect($current-user) if $current-user;
                }
            }
        }
    }
}

sub broadcast-to-all($data) {
    my $json = to-json($data);
    for %clients.values -> $client {
        $client.emit($json);
    }
}

sub broadcast-to-others($sender, $data) {
    my $json = to-json($data);
    for %clients.kv -> $user, $client {
        $client.emit($json) if $user ne $sender;
    }
}

sub handle-disconnect($user) {
    return unless $user;
    return unless %clients{$user}:exists;
    
    %clients{$user}:delete;
    %user-texts{$user}:delete;
    %user-themes{$user}:delete;
    
    broadcast-to-all({
        type => 'leave',
        user => $user
    });
    
    broadcast-to-all({
        type => 'user-count',
        count => %clients.elems
    });
    
    say "User left: $user (total: {%clients.elems})";
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
