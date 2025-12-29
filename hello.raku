use MONKEY-SEE-NO-EVAL;

sub show(Str $expr) {
    my $res = try EVAL $expr;
    say $res.defined 
        ?? qq{"$expr" => } ~ $res.perl
        !! qq{"$expr" -> EVAL failed};
}

show('6 gcd 9');
show('5 <=> 10');
show('a');
